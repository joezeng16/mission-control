/** Choosing strikes and expiries from a quote chain. */
import type { Chain, OptionContract } from '../types'
import { DEFAULT_RATE, IV_FLOOR_HIT, IV_MAX, IV_MIN, bsDelta, impliedVol } from './bs'
import { daysBetween, isIsoDate } from './dates'

const validIv = (iv: number | null): iv is number => iv !== null && Number.isFinite(iv) && iv >= IV_MIN && iv <= IV_MAX

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const MIN_QUOTED = 3          // fewer quoted near-the-money rows than this = the chain is not live (before the open, after hours)
export const FALLBACK_IV = 0.4  // IV used to place strikes when the chain is not live and no last trade gives a usable IV
const NEAR_MONEY = 0.15       // "near the money" = strike within 15% of the stock price
const NEAR_DELTA = 0.03       // a quoted row this close to the best delta beats an unquoted best row

const quoted = (c: OptionContract): boolean => c.bid > 0 && c.ask > 0
const nearMoney = (c: OptionContract, spot: number): boolean => spot > 0 && Math.abs(c.strike / spot - 1) <= NEAR_MONEY
const quotedOf = (rows: OptionContract[], kind?: 'call' | 'put'): OptionContract[] =>
  rows.filter((x) => (!kind || x.type === kind) && quoted(x))

/** True when at least 3 rows within 15% of the stock price (calls and puts) have a bid and an ask. */
export function rowsAreLive(rows: OptionContract[], spot: number): boolean {
  return rows.filter((c) => quoted(c) && nearMoney(c, spot)).length >= MIN_QUOTED
}

/** True when enough near-the-money rows have a bid and an ask to trust the chain's prices and IVs. */
export function chainIsLive(chain: Chain): boolean {
  return rowsAreLive([...chain.puts, ...chain.calls], chain.underlying)
}

/** The contract's IV when it is quoted, else the median IV of quoted same-type rows (unquoted rows carry junk IVs). */
export function chainIv(c: OptionContract, chain: OptionContract[]): number | null {
  if (c.bid > 0 && validIv(c.iv)) return c.iv
  const ivs = quotedOf(chain, c.type).map((x) => x.iv).filter(validIv)
  if (ivs.length > 0) return median(ivs)
  if (validIv(c.iv)) return c.iv
  return median(chain.map((x) => x.iv).filter(validIv))
}

/** Median IV backed out of the LAST-TRADE prices of near-the-money rows (calls and puts); null when none gives a real IV. */
export function lastTradeIv(rows: OptionContract[], spot: number, T: number, r = DEFAULT_RATE, q = 0): number | null {
  if (!(T > 0) || !(spot > 0)) return null
  const ivs = rows
    .filter((c) => nearMoney(c, spot) && c.last != null && c.last > 0)
    .map((c) => impliedVol(c.type, spot, c.strike, T, c.last as number, r, q))
    .filter((iv): iv is number => iv !== null && iv >= IV_FLOOR_HIT && iv < IV_MAX)
  return median(ivs)
}

/** The IV the strike picker uses for each row (the dropdown's odds hint uses the same one):
 *  live chain = chainIv; not live = one IV backed out of near-the-money last trades, FALLBACK_IV if none. */
export function pickerIv(rows: OptionContract[], spot: number, T: number, r = DEFAULT_RATE, q = 0): (c: OptionContract) => number | null {
  if (rowsAreLive(rows, spot)) return (c) => chainIv(c, rows)
  const iv = lastTradeIv(rows, spot, T, r, q) ?? FALLBACK_IV
  return () => iv
}

/** The `kind` contract whose |delta| is nearest |target| (0.30 or -0.30 both work). `contracts` may hold calls and puts
 *  (both feed the live check and the last-trade IV). A quoted row wins when it is within NEAR_DELTA of the best; an
 *  unquoted row is still returned rather than jumping to a far strike that happens to have a bid. */
export function pickByDelta(
  contracts: OptionContract[], kind: 'call' | 'put', target: number, spot: number, T: number, r = DEFAULT_RATE, q = 0
): OptionContract | null {
  const ivOf = pickerIv(contracts, spot, T, r, q)
  const scored: { c: OptionContract; gap: number }[] = []
  for (const c of contracts) {
    if (c.type !== kind || !(c.strike > 0)) continue
    const iv = ivOf(c)
    if (iv === null) continue
    scored.push({ c, gap: Math.abs(Math.abs(bsDelta(kind, spot, c.strike, T, iv, r, q)) - Math.abs(target)) })
  }
  const best = scored.reduce<{ c: OptionContract; gap: number } | null>((b, s) => (!b || s.gap < b.gap ? s : b), null)
  if (!best) return null
  const q1 = scored.filter((s) => s.c.bid > 0).reduce<{ c: OptionContract; gap: number } | null>((b, s) => (!b || s.gap < b.gap ? s : b), null)
  return q1 && q1.gap - best.gap <= NEAR_DELTA ? q1.c : best.c
}

/** The expiry (at least 1 day out) closest to `days` calendar days from today; the earlier one wins a tie. */
export function nearestExpiry(expirations: string[], today: string, days: number): string | null {
  const options = expirations
    .filter(isIsoDate)
    .map((e) => ({ e, d: daysBetween(today, e) }))
    .filter((x) => x.d >= 1)
    .sort((a, b) => Math.abs(a.d - days) - Math.abs(b.d - days) || a.d - b.d)
  return options[0]?.e ?? null
}
