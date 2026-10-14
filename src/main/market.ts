/** Market service (main process): quotes, expirations and option chains from Yahoo (yahoo-finance2, unofficial, about
 *  15 minutes delayed), cached 60 s. Identical requests in flight share one fetch. Read-only.
 *  Ratios leave here as fractions (changePct 0.0123 = 1.23%). */
import type { Chain, OptionContract, Quote } from '../shared/types'

/** The two yahoo-finance2 calls we use; injectable for tests. Results are parsed defensively. */
export interface YahooLike {
  quote(symbol: string): Promise<unknown>
  options(symbol: string, opts?: { date?: Date }): Promise<unknown>
}
export interface MarketService {
  quote(ticker: string): Promise<Quote>
  expirations(ticker: string): Promise<string[]>
  chain(ticker: string, expiry: string): Promise<Chain>
}

export const CACHE_MS = 60_000
export const TIMEOUT_MS = 15_000
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/
const EXPIRY = /^\d{4}-\d{2}-\d{2}$/
const IV_MIN = 0.01
const IV_MAX = 5

/** An implied volatility we trust (Yahoo sends junk like 0.00001 on dead strikes), else null. */
export function cleanIv(iv: number | null): number | null {
  return iv !== null && iv >= IV_MIN && iv <= IV_MAX ? iv : null
}

/** Trimmed, upper-case ticker; throws a plain message when it can't be a ticker. */
export function normalizeTicker(raw: string): string {
  const t = String(raw ?? '').trim().toUpperCase()
  if (!TICKER.test(t)) throw new Error(`"${raw}" is not a valid ticker (letters, digits, "." or "-", up to 10).`)
  return t
}

/** Yahoo spells class shares with a dash: BRK.B -> BRK-B. */
export const yahooSymbol = (ticker: string): string => ticker.replace(/\./g, '-')

type Rec = Record<string, unknown>
const rec = (x: unknown): Rec => (typeof x === 'object' && x !== null ? (x as Rec) : {})
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])

/** Date, epoch seconds/ms, or a date string -> Date (null if unreadable). */
function toDate(x: unknown): Date | null {
  const d = x instanceof Date ? x : typeof x === 'number' ? new Date(x < 1e12 ? x * 1000 : x) : typeof x === 'string' ? new Date(x) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}
const ymd = (x: unknown): string | null => toDate(x)?.toISOString().slice(0, 10) ?? null

function toContract(raw: unknown, type: 'call' | 'put', expiry: string): OptionContract | null {
  const r = rec(raw)
  const strike = num(r.strike)
  if (strike === null || strike <= 0) return null
  const iv = num(r.impliedVolatility)
  return {
    type, expiry, strike,
    bid: num(r.bid) ?? 0, ask: num(r.ask) ?? 0, last: num(r.lastPrice),
    iv: cleanIv(iv),
    oi: num(r.openInterest) ?? 0, volume: num(r.volume) ?? 0
  }
}

function toContracts(raw: unknown, type: 'call' | 'put', expiry: string): OptionContract[] {
  return list(raw)
    .map((c) => toContract(c, type, expiry))
    .filter((c): c is OptionContract => c !== null)
    .sort((a, b) => a.strike - b.strike)
}

async function defaultYahoo(): Promise<YahooLike> {
  const { default: YahooFinance } = await import('yahoo-finance2')
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
  const loose = { validateResult: false } as const
  return {
    quote: (symbol) => yf.quote(symbol, {}, loose),
    options: (symbol, opts) => yf.options(symbol, opts ?? {}, loose)
  }
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Yahoo's raw errors in plain words (rate limit, no internet, timeout); anything else passes through. */
export function plainYahooError(e: unknown): string {
  const m = message(e)
  if (/429|too many requests|rate.?limit/i.test(m)) return 'Yahoo is limiting requests right now; wait a minute and try again.'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|fetch failed/i.test(m)) return "can't reach Yahoo (check the internet connection)."
  return m
}

/** Rejects with 'timed out' when `p` takes longer than `ms` (the request itself is left to finish or fail). */
function withTimeout<T>(p: Promise<T>, ms: number, who: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${who} didn't answer within ${ms / 1000} seconds; try again.`)), ms)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

export interface MarketDeps {
  yf?: YahooLike
  now?: () => Date
  timeoutMs?: number
}

export function createMarketService(deps: MarketDeps = {}): MarketService {
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS
  const now = deps.now ?? (() => new Date())
  const cache = new Map<string, { at: number; value: unknown }>()
  const inFlight = new Map<string, Promise<unknown>>()

  /** One fetch per key at a time: a second identical request waits for the first instead of asking again. */
  function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
    const running = inFlight.get(key)
    if (running) return running as Promise<T>
    const p = load().finally(() => inFlight.delete(key))
    inFlight.set(key, p)
    return p
  }
  let yahoo: Promise<YahooLike> | null = deps.yf ? Promise.resolve(deps.yf) : null
  const getYahoo = (): Promise<YahooLike> =>
    (yahoo ??= defaultYahoo().catch((e: unknown) => { yahoo = null; throw e }))

  async function cached<T>(key: string, what: string, ticker: string, load: (yf: YahooLike) => Promise<T>): Promise<T> {
    const hit = cache.get(key)
    if (hit && now().getTime() - hit.at < CACHE_MS) return hit.value as T
    return shared(key, async (): Promise<T> => {
      let value: T
      try {
        value = await withTimeout(getYahoo().then(load), timeoutMs, 'Yahoo')
      } catch (e) {
        throw new Error(`Couldn't get ${what} for ${ticker} from Yahoo: ${plainYahooError(e)}`)
      }
      cache.set(key, { at: now().getTime(), value })
      return value
    })
  }

  async function quote(raw: string): Promise<Quote> {
    const ticker = normalizeTicker(raw)
    return cached(`quote:${ticker}`, 'a quote', ticker, async (yf) => {
      const q = rec(await yf.quote(yahooSymbol(ticker)))
      const price = num(q.regularMarketPrice)
      if (price === null) throw new Error('no price in the answer')
      const name = q.shortName ?? q.longName ?? q.displayName
      return {
        ticker, name: typeof name === 'string' ? name : null, price,
        change: num(q.regularMarketChange) ?? 0,
        changePct: (num(q.regularMarketChangePercent) ?? 0) / 100,
        time: (toDate(q.regularMarketTime) ?? now()).toISOString()
      }
    })
  }

  async function expirations(raw: string): Promise<string[]> {
    const ticker = normalizeTicker(raw)
    return cached(`exp:${ticker}`, 'option expirations', ticker, async (yf) => {
      const dates = list(rec(await yf.options(yahooSymbol(ticker))).expirationDates).map(ymd)
      return [...new Set(dates.filter((d): d is string => d !== null))].sort()
    })
  }

  async function chain(raw: string, expiry: string): Promise<Chain> {
    const ticker = normalizeTicker(raw)
    if (!EXPIRY.test(expiry) || toDate(`${expiry}T00:00:00Z`) === null) throw new Error(`"${expiry}" is not an expiry date (YYYY-MM-DD).`)
    return cached(`chain:${ticker}:${expiry}`, `the ${expiry} option chain`, ticker, async (yf) => {
      const r = rec(await yf.options(yahooSymbol(ticker), { date: new Date(`${expiry}T00:00:00Z`) }))
      const block = rec(list(r.options).find((o) => ymd(rec(o).expirationDate) === expiry))
      // the chain usually carries the stock price; when it does not, ask for a quote (a 0 would break every strike pick)
      const underlying = num(rec(r.quote).regularMarketPrice) ?? (await quote(ticker)).price
      if (!(underlying > 0)) throw new Error(`Couldn't get ${ticker}'s stock price for the option chain.`)
      return {
        ticker, expiry, underlying,
        calls: toContracts(block.calls, 'call', expiry), puts: toContracts(block.puts, 'put', expiry)
      }
    })
  }

  return { quote, expirations, chain }
}
