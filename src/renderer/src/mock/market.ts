/** Mock market data: a quote, three expirations (~2 weeks, ~40 days, ~1 year) and a Black-Scholes-priced chain. */
import type { Chain, OptionContract, Quote, Signal } from '@shared/types'
import { bsPrice } from '@shared/calc'
import { sampleLive } from './signals'

/** Made-up quotes for a few tickers that are not in the sample scan (any other ticker gets a price from its name). */
const KNOWN: Record<string, { name: string; price: number; change: number; iv: number }> = {
  TSLA: { name: 'Tesla, Inc.', price: 250, change: 4.1, iv: 0.6 },
  SPY: { name: 'SPDR S&P 500 ETF', price: 560, change: 2.2, iv: 0.15 },
  QQQ: { name: 'Invesco QQQ Trust', price: 480, change: 2.9, iv: 0.19 }
}

const allSignals: Signal[] = sampleLive.signals

function hash(s: string): number {
  return [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
}

function profile(ticker: string): { name: string | null; price: number; change: number; iv: number } {
  const known = KNOWN[ticker]
  if (known) return known
  const sig = allSignals.find((s) => s.ticker === ticker)
  const h = hash(ticker)
  const price = sig?.priceNow ?? 20 + (h % 400)
  const change = sig ? sig.priceNow - sig.priceThen : ((h % 600) / 100 - 3) * (price / 100)
  return { name: null, price, change, iv: 0.22 + (h % 25) / 100 }
}

export function mockQuote(ticker: string): Quote {
  const p = profile(ticker)
  const prev = p.price - p.change
  return { ticker, name: p.name, price: p.price, change: p.change, changePct: p.change / prev, time: new Date().toISOString() }
}

function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** The Friday closest to today + days. */
function fridayNear(days: number): string {
  const now = new Date()
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * 86_400_000
  const dow = new Date(base).getUTCDay()
  const forward = (5 - dow + 7) % 7
  const shift = forward > 3 ? forward - 7 : forward
  return isoDay(base + shift * 86_400_000)
}

export function mockExpirations(ticker: string): string[] {
  const fromSignals = allSignals.filter((s) => s.ticker === ticker && s.put).map((s) => s.put?.expiry as string)
  return [...new Set([fridayNear(14), fridayNear(39), fridayNear(366), ...fromSignals])].sort()
}

function strikeStep(price: number): number {
  if (price < 25) return 0.5
  if (price < 60) return 1
  if (price < 120) return 2.5
  if (price < 300) return 5
  if (price < 700) return 10
  return 20
}

function yearsTo(expiry: string): number {
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const [y, m, d] = expiry.split('-').map(Number)
  return Math.max((Date.UTC(y, m - 1, d) - today) / 86_400_000, 1) / 365
}

/** Quote width as a share of mid: tight near the money, wide far out and on cheap contracts. */
function spreadShare(mid: number, moneyness: number): number {
  const base = 0.035 + Math.abs(moneyness) * 0.25
  return Math.min(base + (mid < 0.5 ? 0.25 : mid < 1.5 ? 0.08 : 0), 0.9)
}

function contract(type: 'call' | 'put', S: number, K: number, T: number, baseIv: number, expiry: string): OptionContract {
  const m = Math.log(K / S)
  const iv = baseIv * (1 - 0.35 * m + 0.9 * m * m)
  const mid = Math.max(bsPrice(type, S, K, T, iv), 0.01)
  const half = Math.max((mid * spreadShare(mid, m)) / 2, 0.01)
  const bid = Math.max(Math.round((mid - half) * 100) / 100, 0)
  const ask = Math.round((mid + half) * 100) / 100
  const h = hash(`${type}${K}${expiry}`)
  return { type, expiry, strike: K, bid, ask, last: Math.round(mid * 100) / 100, iv, oi: 50 + (h % 9000), volume: h % 2400 }
}

/** Use the sample scan's put quote for the scanner's own strike, so Calculate shows the same numbers as the table. */
function withScannerQuotes(ticker: string, expiry: string, puts: OptionContract[]): OptionContract[] {
  const quotes = allSignals.filter((s) => s.ticker === ticker && s.put?.expiry === expiry).map((s) => s.put)
  return puts.map((c) => {
    const q = quotes.find((p) => p?.strike === c.strike)
    return q && q.bid != null && q.ask != null ? { ...c, bid: q.bid, ask: q.ask, last: q.mid } : c
  })
}

export function mockChain(ticker: string, expiry: string): Chain {
  const p = profile(ticker)
  const S = p.price
  const step = strikeStep(S)
  const center = Math.round(S / step) * step
  const T = yearsTo(expiry)
  const span = T > 0.5 ? 18 : 14
  const extra = allSignals.filter((s) => s.ticker === ticker && s.put).flatMap((s) => [s.put?.strike, s.put?.wingStrike])
  const grid = Array.from({ length: span * 2 + 1 }, (_, i) => Number((center + (i - span) * step).toFixed(2)))
  const strikes = [...new Set([...grid, ...extra.filter((k): k is number => k != null)])].filter((k) => k > 0).sort((a, b) => a - b)
  const calls = strikes.map((K) => contract('call', S, K, T, p.iv, expiry))
  const puts = withScannerQuotes(ticker, expiry, strikes.map((K) => contract('put', S, K, T, p.iv, expiry)))
  return { ticker, expiry, underlying: S, calls, puts }
}
