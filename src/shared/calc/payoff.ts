/** Position P/L and Greeks at a stock price and day. All dollars. */
import { IV_MIN, bsGreeks, intrinsic, optionValue } from './bs'
import { daysBetween } from './dates'
import type { Greeks, Leg, Position } from './types'

export const MULTIPLIER = 100
export interface CurvePoint { x: number; expiry: number; at: number; today: number }

type OptionLeg = Leg & { kind: 'call' | 'put'; strike: number }
export const isOptionLeg = (l: Leg): l is OptionLeg => l.kind !== 'stock' && l.strike !== null

/** Calendar days from `today` to the position's expiry (never negative). */
export function daysToExpiry(p: Position, today: string): number {
  return Math.max(0, daysBetween(today, p.expiry))
}

/** Used IV = leg IV + shift (fraction, +0.10 = +10 points), floored at 1%. */
export function shiftedIv(iv: number | null, ivShift: number): number {
  return Math.max(IV_MIN, (iv ?? IV_MIN) + ivShift)
}

const units = (p: Position): number => MULTIPLIER * p.contracts
const clampDays = (p: Position, daysLeft: number, today: string): number =>
  Math.min(Math.max(0, daysLeft), daysToExpiry(p, today))

function legValue(p: Position, leg: Leg, S: number, T: number, ivShift: number): number {
  if (!isOptionLeg(leg)) return S
  return optionValue(leg.kind, S, leg.strike, T, shiftedIv(leg.iv, ivShift), p.rate, p.dividend)
}

/** P/L at expiry (intrinsic only; the IV shift never moves it). */
export function plAtExpiry(p: Position, S: number): number {
  return p.legs.reduce((sum, leg) => {
    const value = isOptionLeg(leg) ? intrinsic(leg.kind, S, leg.strike) : S
    return sum + leg.side * (value - leg.price) * units(p)
  }, 0)
}

/** P/L with `daysLeft` calendar days still to run (DTE = today, 0 = expiry), every leg's IV shifted by `ivShift`. */
export function plAt(p: Position, S: number, daysLeft: number, ivShift: number, today: string): number {
  const T = clampDays(p, daysLeft, today) / 365
  return p.legs.reduce((sum, leg) => sum + leg.side * (legValue(p, leg, S, T, ivShift) - leg.price) * units(p), 0)
}

/** Position Greeks. Delta/gamma in shares, theta $/calendar day, vega $/IV point; shares add delta. */
export function greeks(p: Position, S: number, daysLeft: number, ivShift: number, today: string): Greeks {
  const T = clampDays(p, daysLeft, today) / 365
  return p.legs.reduce<Greeks>((g, leg) => {
    const n = leg.side * units(p)
    if (!isOptionLeg(leg)) return { ...g, delta: g.delta + n }
    const o = bsGreeks(leg.kind, S, leg.strike, T, shiftedIv(leg.iv, ivShift), p.rate, p.dividend)
    return { delta: g.delta + n * o.delta, gamma: g.gamma + n * o.gamma, theta: g.theta + n * o.theta / 365, vega: g.vega + n * o.vega / 100 }
  }, { delta: 0, gamma: 0, theta: 0, vega: 0 })
}

/** "Just buy the shares" line: 100 x contracts shares bought at the current price. */
export function sharesPl(p: Position, S: number, spot: number): number {
  return (S - spot) * units(p)
}

export function strikes(p: Position): number[] {
  return uniqueSorted(p.legs.filter(isOptionLeg).map((l) => l.strike))
}

function uniqueSorted(xs: number[]): number[] {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted.filter((x, k) => k === 0 || Math.abs(x - sorted[k - 1]) > 1e-9)
}

/** Prices where the expiry P/L crosses $0 ([] = never). The expiry payoff is straight between strikes. */
export function breakevens(p: Position): number[] {
  const xs = [0, ...strikes(p).filter((k) => k > 0)]
  const ys = xs.map((x) => plAtExpiry(p, x))
  const roots: number[] = []
  for (let k = 0; k < xs.length; k++) {
    if (ys[k] === 0 && xs[k] > 0) roots.push(xs[k])
    if (k + 1 < xs.length && ys[k] * ys[k + 1] < 0) roots.push(xs[k] + (-ys[k] * (xs[k + 1] - xs[k])) / (ys[k + 1] - ys[k]))
  }
  const last = xs[xs.length - 1]
  const yLast = ys[ys.length - 1]
  const slope = plAtExpiry(p, last + 1) - yLast
  if (yLast !== 0 && slope !== 0 && -yLast / slope > 0) roots.push(last - yLast / slope)
  return uniqueSorted(roots)
}

/** N evenly spaced prices in [lo, hi] plus the exact strikes and breakevens, each with the three curves.
 *  `at` = chosen day (daysLeft to run), `today` = now; both use ivShift (pass 0 for the dashed unshifted copies). */
export function curve(p: Position, lo: number, hi: number, n: number, daysLeft: number, ivShift: number, today: string): CurvePoint[] {
  const count = Math.max(2, Math.floor(n))
  const grid = Array.from({ length: count }, (_, k) => lo + (k * (hi - lo)) / (count - 1))
  const marks = [...strikes(p), ...breakevens(p)].filter((x) => x >= lo && x <= hi)
  const dte = daysToExpiry(p, today)
  return uniqueSorted([...grid, ...marks]).map((x) => ({
    x,
    expiry: plAtExpiry(p, x),
    at: plAt(p, x, daysLeft, ivShift, today),
    today: plAt(p, x, dte, ivShift, today)
  }))
}
