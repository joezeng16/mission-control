/** Chart helpers: x range with nice ticks, y range, and the hover readout. */
import { greeks as positionGreeks, breakevens, daysToExpiry, isOptionLeg, plAt, plAtExpiry, sharesPl, strikes } from './payoff'
import { perShare, signedPercent } from './format'
import type { Greeks, Position } from './types'

export interface PriceRange { lo: number; hi: number; step: number; ticks: number[]; expectedMove: number }
export interface HoverReadout {
  price: number; pctFromSpot: number
  today: number; at: number; expiry: number
  todayBase: number; atBase: number
  shares: number
  greeks: Greeks
}

const STEPS = [1, 2, 2.5, 5]
const TARGET_TICKS = 10

const snap = (x: number): number => Number(x.toFixed(10))

/** Round [lo, hi] outward to a 1/2/2.5/5 x 10^n step, aiming for 8-12 ticks (closest to 10 wins). */
export function niceAxis(lo: number, hi: number): { lo: number; hi: number; step: number; ticks: number[] } {
  const span = Math.max(hi - lo, Math.abs(hi) * 0.01, 1e-6)
  const mag = Math.floor(Math.log10(span))
  let best = { lo, hi, step: span, count: 2, score: Infinity }
  for (let e = mag - 2; e <= mag + 1; e++) {
    for (const m of STEPS) {
      const step = m * 10 ** e
      const a = snap(Math.floor(lo / step) * step)
      const b = snap(Math.ceil(hi / step) * step)
      const count = Math.round((b - a) / step) + 1
      const score = (count >= 8 && count <= 12 ? 0 : 100) + Math.abs(count - TARGET_TICKS)
      if (score < best.score) best = { lo: a, hi: b, step, count, score }
    }
  }
  const ticks = Array.from({ length: best.count }, (_, k) => snap(best.lo + k * best.step))
  return { lo: best.lo, hi: best.hi, step: best.step, ticks }
}

/** Spot +/- 2 expected moves, widened to show every strike and breakeven, never below $0. */
export function priceRange(p: Position, spot: number, today: string): PriceRange {
  const ivs = p.legs.filter(isOptionLeg).map((l) => l.iv ?? 0)
  const avgIv = ivs.length > 0 ? ivs.reduce((s, v) => s + v, 0) / ivs.length : 0
  const expectedMove = spot * avgIv * Math.sqrt(daysToExpiry(p, today) / 365)
  const marks = [...strikes(p), ...breakevens(p), spot]
  const lo = Math.max(0, Math.min(spot - 2 * expectedMove, Math.min(...marks) - 0.5 * expectedMove))
  const hi = Math.max(spot + 2 * expectedMove, Math.max(...marks) + 0.5 * expectedMove)
  return { ...niceAxis(lo, hi), expectedMove }
}

/** Min/max of every visible value (ghosts too), always including $0, plus 10% of the span each side. */
export function yRange(values: number[]): { lo: number; hi: number } {
  const finite = values.filter(Number.isFinite)
  const lo = Math.min(0, ...finite)
  const hi = Math.max(0, ...finite)
  const pad = (hi - lo) * 0.1 || 1
  return { lo: lo - pad, hi: hi + pad }
}

/** Pointer price rounded to $0.01, or $0.05 when the stock is over $100. */
export function hoverPrice(pointer: number, spot: number): number {
  const step = spot > 100 ? 0.05 : 0.01
  return Number((Math.round(pointer / step) * step).toFixed(2))
}

/** Everything the hover box shows at the pointer. todayBase/atBase are the unshifted values. */
export function hoverAt(p: Position, pointer: number, spot: number, daysLeft: number, ivShift: number, today: string): HoverReadout {
  const price = hoverPrice(pointer, spot)
  const dte = daysToExpiry(p, today)
  return {
    price,
    pctFromSpot: (price - spot) / spot,
    today: plAt(p, price, dte, ivShift, today),
    at: plAt(p, price, daysLeft, ivShift, today),
    expiry: plAtExpiry(p, price),
    todayBase: plAt(p, price, dte, 0, today),
    atBase: plAt(p, price, daysLeft, 0, today),
    shares: sharesPl(p, price, spot),
    greeks: positionGreeks(p, price, dte, ivShift, today)
  }
}

/** "$113.00, -5.8%" */
export function hoverHeader(h: HoverReadout): string {
  return `${perShare(h.price)}, ${signedPercent(h.pctFromSpot)}`
}
