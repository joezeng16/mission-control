/** Small builders that turn compact mock rows into the shared contract types. Percent inputs become fractions. */
import { TAKE_PROFIT_LEFT, WIDE_SPREAD } from '@shared/defaults'
import type { ExitRow, ExitTag, Level, PutQuote, Signal } from '@shared/types'

const CLOSED_NOTE = 'market closed: last trade price, check again at the open'

export interface PutSpec {
  exp: string
  strike: number
  bid: number
  ask: number
  delta: number
  wing?: number
  wingMid?: number
  /** A scan before the open / after the close: bid and ask 0, the mid is the last trade. */
  last?: number
}

export function buildPut(p: PutSpec): PutQuote {
  const live = p.last == null
  const mid = live ? (p.bid + p.ask) / 2 : (p.last as number)
  const spreadPct = live && mid > 0 ? (p.ask - p.bid) / mid : null
  const hasWing = p.wing != null && p.wingMid != null
  return {
    expiry: p.exp,
    strike: p.strike,
    bid: p.bid,
    ask: p.ask,
    mid,
    spreadPct,
    delta: p.delta,
    note: !live ? CLOSED_NOTE : spreadPct != null && spreadPct > WIDE_SPREAD ? 'WIDE spread: use a limit near the mid' : null,
    wingStrike: hasWing ? (p.wing as number) : null,
    wingMid: hasWing ? (p.wingMid as number) : null,
    credit: hasWing ? mid - (p.wingMid as number) : null,
    width: hasWing ? p.strike - (p.wing as number) : null,
    buyback: mid * TAKE_PROFIT_LEFT,
    live
  }
}

export interface SigSpec {
  t: string
  lv: Level
  kind?: Signal['kind']
  date: string
  ago: number
  then: number
  now: number
  wonPct: number | null
  n: number
  earn: string | null
  border?: boolean
  detail?: string | null
  put: PutSpec | null
}

const frac = (v: number | null | undefined): number | null => (v == null ? null : v / 100)

export function buildSignal(s: SigSpec): Signal {
  return {
    ticker: s.t,
    level: s.lv,
    kind: s.kind ?? 'tagged',
    date: s.date,
    daysAgo: s.ago,
    priceThen: s.then,
    priceNow: s.now,
    won: frac(s.wonPct),
    trades: s.n,
    nextEarn: s.earn,
    tested: null,
    borderline: s.border ?? false,
    detail: s.detail ?? null,
    put: s.put ? buildPut(s.put) : null
  }
}

/** [ticker, level, enter date, enter price, tag, exit date, days ago, price, forming?] */
export type ExitSpec = [string, Level, string, number, ExitTag, string, number, number, boolean?]

export function buildExit([ticker, level, enter, enterPrice, tag, date, daysAgo, price, forming]: ExitSpec): ExitRow {
  return { ticker, level, enter, enterPrice, tag, date, daysAgo, price, move: price / enterPrice - 1, forming: forming ?? false }
}
