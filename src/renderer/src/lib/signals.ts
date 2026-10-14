/** Pure helpers for the signals table: filter, sort, derived money numbers, plain-words labels. */
import { MIN_TRADES, TAKE_PROFIT_LEFT, WIDE_SPREAD } from '@shared/defaults'
import type { ExitRow, ExitTag, Level, PutQuote, Signal, Tested } from '@shared/types'
import type { CalcRequest } from './calcRequest'
import { pct } from './format'

export { MIN_TRADES }

export type LevelFilter = 'all' | 'top2' | 'top1'
export type SortKey = 'stock' | 'level' | 'when' | 'move' | 'put' | 'collect' | 'spread' | 'won' | 'earn'
export interface SortState {
  key: SortKey
  dir: 'asc' | 'desc'
}

export const DEFAULT_SORT: SortState = { key: 'level', dir: 'desc' }

export const LEVEL_FILTERS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'top2', label: '3/3 + 2/3' },
  { value: 'top1', label: '3/3 only' }
]

export function passesFilter(level: Level, f: LevelFilter): boolean {
  return f === 'all' || (f === 'top2' ? level >= 2 : level === 3)
}

/** What one sold put collects at the mid (cash-secured: no wing). */
export function collectPerContract(s: Signal): number | null {
  return s.put?.mid != null ? s.put.mid * 100 : null
}

/** The put credit spread on a row (sell the row's strike, buy the scanner's wing), per contract. */
export interface SpreadView {
  wingStrike: number
  /** Per share collected at the mids (sold put mid − wing mid). */
  credit: number
  width: number
  /** $ for one contract: credit × 100. */
  collect: number
  /** $ the spread can lose for one contract: (width − credit) × 100. */
  risk: number
  /** Good-till-canceled buy-back per share: the take-profit rule applied to the credit. */
  buyback: number
}

export function spreadOf(put: PutQuote | null | undefined): SpreadView | null {
  if (!put || put.wingStrike == null || put.credit == null || put.width == null) return null
  const { credit, width } = put
  if (!Number.isFinite(credit) || !Number.isFinite(width) || credit <= 0 || width <= credit) return null
  return { wingStrike: put.wingStrike, credit, width, collect: credit * 100, risk: (width - credit) * 100, buyback: credit * TAKE_PROFIT_LEFT }
}

/** The row's good-till-canceled buy-back price: the spread's when there is one, else the put's. */
export function rowBuyback(put: PutQuote | null | undefined): number | null {
  return spreadOf(put)?.buyback ?? put?.buyback ?? null
}

/** The Collect column's number: one spread at the mid, else one cash-secured put. */
export function collectValue(s: Signal): number | null {
  return spreadOf(s.put)?.collect ?? collectPerContract(s)
}

/** Cash a cash-secured put ties up. */
export function cashPerContract(s: Signal): number | null {
  return s.put ? s.put.strike * 100 : null
}

export function moveSince(s: Signal): number {
  return s.priceThen > 0 ? s.priceNow / s.priceThen - 1 : 0
}

export const WIDE = WIDE_SPREAD

export function isWide(spreadPct: number | null | undefined): boolean {
  return spreadPct != null && spreadPct > WIDE
}

/** Needs a human look: the scanner flagged it borderline, or it is a near miss. */
export function needsChartCheck(s: Signal): boolean {
  return s.borderline || s.kind === 'near'
}

function sortValue(s: Signal, key: SortKey): number | string {
  switch (key) {
    case 'stock': return s.ticker
    case 'level': return s.level
    case 'when': return -s.daysAgo
    case 'move': return moveSince(s)
    case 'put': return s.put?.strike ?? -Infinity
    case 'collect': return hasLiveQuote(s.put) ? (collectValue(s) ?? -Infinity) : -Infinity   // last-trade prices sort last
    case 'spread': return hasLiveQuote(s.put) ? (s.put?.spreadPct ?? Infinity) : Infinity
    case 'won': return s.won ?? -Infinity
    case 'earn': return s.nextEarn ?? '9999'
  }
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b))
  return a === b ? 0 : a < b ? -1 : 1
}

export function sortSignals<T extends Signal>(rows: readonly T[], sort: SortState): T[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const primary = compare(sortValue(a, sort.key), sortValue(b, sort.key)) * dir
    if (primary !== 0) return primary
    const byLevel = b.level - a.level
    return byLevel !== 0 ? byLevel : a.daysAgo - b.daysAgo || a.ticker.localeCompare(b.ticker)
  })
}

export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, dir: key === 'stock' || key === 'earn' || key === 'spread' ? 'asc' : 'desc' }
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

/** What each exit tag asks you to do, in plain words (the scanner decides when a tag fires). */
export const EXIT_TODO: Record<ExitTag, string> = {
  TP: 'Take profit: sell all',
  'TP 1': 'Take profit: sell half',
  'TP 2': 'Take profit: sell the rest',
  'STOP LOSS': 'Stop loss: sell all',
  TIME: 'Time limit: sell all'
}

export function sortExits(rows: readonly ExitRow[]): ExitRow[] {
  return [...rows].sort((a, b) => a.daysAgo - b.daysAgo || b.level - a.level || a.ticker.localeCompare(b.ticker))
}

/** A put you can trade off: the scan saw a real bid and ask (not a last trade before the open / after the close). */
export function hasLiveQuote(put: PutQuote | null | undefined): boolean {
  return put != null && put.live && (put.bid ?? 0) > 0 && (put.ask ?? 0) > 0
}

/** What the Calculate button hands the calculator (a put credit spread). Without a live quote the calculator picks a fresh
 *  strike and wing itself. */
export function calcRequestFor(s: Signal): Omit<CalcRequest, 'nonce'> {
  const p = s.put && hasLiveQuote(s.put) ? s.put : null
  return {
    ticker: s.ticker,
    strike: p?.strike ?? null,
    expiry: p?.expiry ?? null,
    wingStrike: p?.wingStrike != null && p.wingStrike < p.strike ? p.wingStrike : null,
    level: s.level,
    live: p != null,
    tested: s.tested,
    buyback: p ? rowBuyback(p) : null
  }
}

export function tradesLabel(n: number): string {
  if (n <= 0) return 'no trades'
  return n === 1 ? '1 trade' : `${n} trades`
}

export interface WonView {
  rate: string
  count: string
  few: boolean
}

/** The Won cell: the stock's historical win rate at this level and the trade count behind it. */
export function wonView(s: Signal): WonView {
  const few = s.trades < MIN_TRADES
  return {
    rate: pct(s.won),
    count: few && s.trades > 0 ? `only ${tradesLabel(s.trades)}` : tradesLabel(s.trades),
    few
  }
}

/** The level's optional backtest result from the scan file, said plainly; null when the scanner wrote none. */
export function testedText(t: Tested | null | undefined): string | null {
  if (!t || t.putWon == null || t.putAvg == null) return null
  return `Backtest: ${pct(t.putWon)} won, avg ${pct(t.putAvg, 1, true)} of cash`
}

/** The scanner's put note in plain words (the stale case gets a full sentence). */
export function plainPutNote(put: PutQuote): string | null {
  const note = put.note?.trim() || null
  if (hasLiveQuote(put)) return note
  if (note && /market closed/i.test(note)) {
    return 'The market was closed when the scan ran, so this is the last trade price, not a price you can get now. Check again at the open.'
  }
  if (note && /chain unavailable/i.test(note)) return 'The scanner got no option prices for this stock when it ran.'
  return note ?? 'No live bid and ask when the scan ran, so this is the last trade price, not a price you can get now.'
}

const NOTABLE = /not scanned|no close|dropped|too new|chain unavailable/i

/** Scanner output lines worth keeping after a run (stocks skipped, dropped or missing prices), each once. */
export function notableLines(lines: readonly string[]): string[] {
  return lines.filter((l, i) => NOTABLE.test(l) && lines.indexOf(l) === i).map((l) => l.trim())
}
