import { describe, expect, it } from 'vitest'
import {
  IV_FLOOR_HIT, InputError, addDays, bsDelta, bsPrice, buildPosition, chainIv, curve, greeks, hoverAt, hoverHeader, impliedVol, lastTradeIv, pickerIv,
  chainIsLive, nearestExpiry, optionValue, pickByDelta, plAt, plAtExpiry, priceRange, signedMoney, stats, validateInputs, yRange,
  type ManualLeg, type Position, type Stats, type StrategyInputs
} from '../src/shared/calc'
import type { OptionContract } from '../src/shared/types'

const TODAY = '2026-10-12'
const on = (days: number): string => addDays(TODAY, days)
const leg = (strike: number, premium?: number): ManualLeg => ({ strike, premium })

// Tolerances: expected values are hand-checked, displayed (rounded) numbers.
const num = (x: unknown): number => { expect(typeof x).toBe('number'); return x as number }
const close = (actual: unknown, expected: number, tol: number): void =>
  expect(Math.abs(num(actual) - expected)).toBeLessThanOrEqual(tol + 1e-9)
const cents = (a: unknown, e: number): void => close(a, e, 0.01)
const dollars = (a: unknown, e: number): void => close(a, e, 1)
const pct = (a: unknown, ePct: number): void => close(Math.round(num(a) * 1000) / 10, ePct, 0.1)
const ivPts = pct
const chance = (a: unknown, ePct: number): void => close(Math.round(num(a) * 100), ePct, 1)
const greek = (a: unknown, e: number): void => close(a, e, Math.abs(e) * 0.01)

const base = { today: TODAY, contracts: 1 }
const A1in: StrategyInputs = { ...base, spot: 80, expiry: on(40), short: leg(75), ivOverride: 0.35 }
const A2in: StrategyInputs = { ...base, spot: 25, contracts: 4, expiry: on(28), short: leg(23, 0.55) }
const A3in: StrategyInputs = { ...base, spot: 120, expiry: on(30), short: leg(115), long: leg(110), ivOverride: 0.30 }
const A4in: StrategyInputs = { ...base, spot: 300, contracts: 3, expiry: on(21), short: leg(290, 4.40), long: leg(280, 2.30) }
const A5in: StrategyInputs = { ...base, spot: 75, contracts: 2, expiry: on(45), call: leg(80), ivOverride: 0.50 }
const A6in: StrategyInputs = { ...base, spot: 180, expiry: on(540), call: leg(150), ivOverride: 0.32, dividend: 0.004 }
const A7in: StrategyInputs = { ...base, spot: 60, contracts: 2, expiry: on(35), call: leg(65), ivOverride: 0.38 }
const A8in: StrategyInputs = { ...base, spot: 15, contracts: 5, expiry: on(14), call: leg(16, 0.30) }

const A1 = buildPosition('csp', A1in)
const A2 = buildPosition('csp', A2in)
const A3 = buildPosition('put_credit_spread', A3in)
const A4 = buildPosition('put_credit_spread', A4in)
const A5 = buildPosition('long_call', A5in)
const A6 = buildPosition('long_call', A6in)
const A7 = buildPosition('covered_call', A7in)
const A8 = buildPosition('covered_call', A8in)

describe('acceptance cases', () => {
  it('A1 cash-secured put, IV mode', () => {
    cents(A1.legs[0].price, 1.52)
    const s = stats(A1, 80, TODAY)
    dollars(s.premiumTotal, 152); dollars(s.cash, 7500)
    dollars(s.maxProfit, 152); dollars(s.maxLoss, -7348)
    expect(s.breakevens).toHaveLength(1); cents(s.breakevens[0], 73.48)
    pct(s.returnOnCash, 2.0); pct(s.perYear, 18.5); pct(s.cushion, 8.2)
    chance(s.chanceOfProfit, 76); chance(s.chanceOfMaxProfit, 70)
    const g = greeks(A1, 80, 40, 0, TODAY)
    greek(g.delta, 25.7); greek(g.theta, 3.49); greek(g.vega, -8.54)
  })

  it('A2 cash-secured put, premium mode', () => {
    ivPts(A2.legs[0].iv, 50.6)
    const s = stats(A2, 25, TODAY)
    dollars(s.premiumTotal, 220); dollars(s.cash, 9200); dollars(s.maxLoss, -8980)
    cents(s.breakevens[0], 22.45)
    pct(s.returnOnCash, 2.4); pct(s.perYear, 31.2); pct(s.cushion, 10.2)
    chance(s.chanceOfProfit, 76)
  })

  it('A3 put credit spread, IV mode', () => {
    cents(A3.legs[0].price, 1.89); cents(A3.legs[1].price, 0.75)
    const s = stats(A3, 120, TODAY)
    cents(s.netPremium, 1.15)
    dollars(s.maxProfit, 115); dollars(s.maxLoss, -385); dollars(s.cash, 385)
    cents(s.breakevens[0], 113.85)
    pct(s.returnOnCash, 29.8)
    chance(s.chanceOfProfit, 73); chance(s.chanceOfMaxProfit, 69)
  })

  it('A3-curves', () => {
    dollars(plAt(A3, 120, 30, 0, TODAY), 0)
    dollars(plAt(A3, 113, 30, 0, TODAY), -125)
    dollars(plAt(A3, 120, 15, 0, TODAY), 40)
    dollars(plAt(A3, 113, 15, 0, TODAY), -121)
    dollars(plAtExpiry(A3, 113), -85)
    dollars(plAtExpiry(A3, 125), 115)
    dollars(plAtExpiry(A3, 105), -385)
  })

  it('A3-IV shift', () => {
    dollars(plAt(A3, 120, 30, 0.10, TODAY), -34)
    dollars(plAt(A3, 120, 30, -0.10, TODAY), 50)
    dollars(plAt(A3, 113, 15, 0.10, TODAY), -128)
    const pts = (shift: number) => curve(A3, 100, 130, 31, 15, shift, TODAY).find((p) => p.x === 113)
    dollars(pts(0.1)?.expiry, -85); dollars(pts(-0.5)?.expiry, -85); dollars(pts(0.5)?.expiry, -85)
  })

  it('A4 put credit spread, premium mode', () => {
    ivPts(A4.legs[0].iv, 30.9); ivPts(A4.legs[1].iv, 33.0)
    const s = stats(A4, 300, TODAY)
    cents(s.netPremium, 2.10)
    dollars(s.maxProfit, 630); dollars(s.maxLoss, -2370)
    cents(s.breakevens[0], 287.90)
    pct(s.returnOnCash, 26.6)
    chance(s.chanceOfProfit, 71)
  })

  it('A5 long call, IV mode', () => {
    cents(A5.legs[0].price, 3.41)
    const s = stats(A5, 75, TODAY)
    dollars(s.cash, 682); dollars(s.premiumTotal, -682); dollars(s.maxLoss, -682)
    expect(s.maxProfit).toBe('unlimited')
    cents(s.breakevens[0], 83.41)
    chance(s.chanceOfProfit, 25)
    expect(s.chanceOfMaxProfit).toBeNull()
    const g = greeks(A5, 75, 45, 0, TODAY)
    greek(g.delta, 80.1); greek(g.theta, -11.89); greek(g.vega, 20.36)
  })

  it('A5-curves', () => {
    dollars(plAtExpiry(A5, 90), 1318)
    dollars(plAtExpiry(A5, 70), -682)
    dollars(plAt(A5, 75, 15, 0, TODAY), -427)
    dollars(plAt(A5, 75, 45, 0.10, TODAY), 205)
    dollars(plAt(A5, 75, 45, -0.10, TODAY), -201)
  })

  it('A6 long call (LEAPS) with a dividend', () => {
    const s = stats(A6, 180, TODAY)
    expect(s.leaps).toBe(true)
    cents(A6.legs[0].price, 47.81)
    expect(s.legs[0].moneyness).toBe('ITM')
    dollars(s.cash, 4781)
    cents(s.intrinsic, 30); cents(s.extrinsic, 17.81)
    cents(s.breakevens[0], 197.81); pct(s.breakevenPct, 9.9)
    chance(s.chanceOfProfit, 38)
    dollars(plAt(A6, 180, 270, 0, TODAY), -825)
    dollars(plAtExpiry(A6, 250), 5219)
    expect(stats(A5, 75, TODAY).leaps).toBe(false)
  })

  it('A7 covered call, IV mode', () => {
    cents(A7.legs.find((l) => l.kind === 'call')?.price, 1.14)
    const s = stats(A7, 60, TODAY)
    expect(s.legs[0].moneyness).toBe('OTM')
    dollars(s.premiumTotal, 229); dollars(s.cash, 11771)
    cents(s.breakevens[0], 58.86)
    dollars(s.ifCalledAway, 1229); pct(s.ifCalledAwayPct, 10.4)
    dollars(s.ifFlat, 229); pct(s.ifFlatPct, 1.9); pct(s.perYear, 20.2)
    dollars(s.maxLoss, -11771)
    chance(s.chanceOfProfit, 55); chance(s.chanceOfMaxProfit, 24)
    const g = greeks(A7, 60, 35, 0, TODAY)
    greek(g.delta, 144.4); greek(g.theta, 7.11)
    dollars(plAt(A7, 60, 35, 0, TODAY), 0)
    dollars(plAtExpiry(A7, 70), 1229)
    dollars(plAtExpiry(A7, 50), -1771)
  })

  it('A8 covered call, premium mode', () => {
    ivPts(A8.legs.find((l) => l.kind === 'call')?.iv, 56.2)
    const s = stats(A8, 15, TODAY)
    dollars(s.cash, 7350)
    dollars(s.ifCalledAway, 650); pct(s.ifCalledAwayPct, 8.8)
    dollars(s.ifFlat, 150); pct(s.ifFlatPct, 2.0)
    cents(s.breakevens[0], 14.70)
    dollars(s.maxLoss, -7350)
  })

  it('A9 intrinsic floor', () => {
    const today50 = plAt(A1, 50, 40, 0, TODAY)
    dollars(today50, -2348)
    dollars(today50, plAtExpiry(A1, 50))
    const unfloored = -(bsPrice('put', 50, 75, 40 / 365, 0.35) - A1.legs[0].price) * 100
    dollars(unfloored, -2315)
    expect(optionValue('put', 50, 75, 40 / 365, 0.35)).toBe(25)
  })

  it('A10 entry anchor', () => {
    const ivMode: [Position, number][] = [[A1, 80], [A3, 120], [A5, 75], [A6, 180], [A7, 60]]
    for (const [p, spot] of ivMode) expect(Math.abs(plAt(p, spot, num(stats(p, spot, TODAY).daysToExpiry), 0, TODAY))).toBeLessThan(0.005)
    const premiumMode: [Position, number][] = [[A2, 25], [A4, 300], [A8, 15]]
    for (const [p, spot] of premiumMode) close(plAt(p, spot, stats(p, spot, TODAY).daysToExpiry, 0, TODAY), 0, 1)
  })

  it('A11 price range', () => {
    const r = priceRange(A1, 80, TODAY)
    cents(r.expectedMove, 9.27)
    expect(r.lo).toBeLessThanOrEqual(61.46); expect(r.hi).toBeGreaterThanOrEqual(98.54)
    expect(r.lo).toBeLessThanOrEqual(73.48); expect(r.hi).toBeGreaterThanOrEqual(75)
    expect(r.lo).toBeGreaterThanOrEqual(0)
    expect(r.ticks.length).toBeGreaterThanOrEqual(8); expect(r.ticks.length).toBeLessThanOrEqual(12)
    const wild = buildPosition('csp', { ...base, spot: 10, expiry: on(1000), short: leg(9), ivOverride: 3 })
    expect(priceRange(wild, 10, TODAY).lo).toBe(0)
  })

  it('A12 hover readout', () => {
    const h = hoverAt(A3, 113.0, 120, 15, 0, TODAY)
    expect(hoverHeader(h)).toBe('$113.00, -5.8%')
    dollars(h.today, -125); dollars(h.at, -121); dollars(h.expiry, -85)
    dollars(h.today, -125) // the horizontal guide sits at the today P/L
    expect(hoverAt(A3, 113.03, 120, 15, 0, TODAY).price).toBeCloseTo(113.05, 10)
    expect(hoverAt(A1, 77.333, 80, 20, 0, TODAY).price).toBeCloseTo(77.33, 10)
    expect(signedMoney(-125.4)).toBe('-$125')
  })

  it('A13 validation', () => {
    const spread = (o: Partial<StrategyInputs>) => validateInputs('put_credit_spread', { ...A3in, ...o })
    expect(spread({ long: leg(116) })).toContainEqual({ field: 'long.strike', message: 'bought strike must be below sold strike' })
    expect(() => buildPosition('put_credit_spread', { ...A3in, long: leg(116) })).toThrow(InputError)
    const wide = { ...A3in, ivOverride: undefined, short: leg(115, 5.50), long: leg(110, 0.50) }
    expect(validateInputs('put_credit_spread', wide)).toContainEqual({ field: 'credit', message: 'credit must be above $0 and below the strike width' })
    expect(validateInputs('csp', { ...A2in, short: leg(23, 0) }).map((e) => e.field)).toContain('short.premium')
    expect(validateInputs('csp', { ...A1in, contracts: 2.5 }).map((e) => e.field)).toContain('contracts')
    expect(validateInputs('csp', { ...A1in, ivOverride: 5.5 }).map((e) => e.field)).toContain('iv')
    expect(validateInputs('csp', { ...A1in, expiry: on(1101) }).map((e) => e.field)).toContain('expiry')
    expect(validateInputs('csp', { ...A1in, spot: 0 }).map((e) => e.field)).toContain('spot')
    expect(validateInputs('csp', { ...A2in, short: leg(23, 30) })).toContainEqual(
      { field: 'short.premium', message: 'premium is outside what this strike and expiry allow' })
    expect(validateInputs('csp', A1in)).toEqual([])
  })

  it('A14 date slider limits', () => {
    const r = priceRange(A5, 75, TODAY)
    for (const p of curve(A5, r.lo, r.hi, 240, 45, 0, TODAY)) close(p.at, p.today, 0.01)
    for (const p of curve(A5, r.lo, r.hi, 240, 0, 0, TODAY)) close(p.at, p.expiry, 0.01)
  })
})

describe('calculator edge cases', () => {
  it('long call max profit is unlimited', () => {
    const s = stats(A6, 180, TODAY)
    expect(s.maxProfit).toBe('unlimited')
    expect(s.chanceOfMaxProfit).toBeNull()
  })

  it('no breakeven when always profitable', () => {
    const p: Position = { ...A3, legs: [{ ...A3.legs[0], price: 6.0 }, { ...A3.legs[1], price: 0.5 }] }
    const s: Stats = stats(p, 120, TODAY)
    expect(s.breakevens).toEqual([])
    expect(s.chanceOfProfit).toBe(1)
    expect(s.maxLoss).toBe(0)
    for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
  })

  it('curve samples include the exact strikes and breakevens', () => {
    const xs = curve(A3, 100, 130, 240, 15, 0, TODAY).map((p) => p.x)
    expect(xs).toContain(110); expect(xs).toContain(115)
    expect(xs.some((x) => Math.abs(x - stats(A3, 120, TODAY).breakevens[0]) < 1e-9)).toBe(true)
    expect(xs.length).toBeGreaterThanOrEqual(240)
  })

  it('a full recompute (3 curves + ghosts + stats) takes under 50 ms', () => {
    const t0 = performance.now()
    const r = priceRange(A4, 300, TODAY)
    const shifted = curve(A4, r.lo, r.hi, 240, 10, 0.1, TODAY)
    const ghosts = curve(A4, r.lo, r.hi, 240, 10, 0, TODAY)
    yRange([...shifted, ...ghosts].flatMap((p) => [p.today, p.at, p.expiry]))
    stats(A4, 300, TODAY); greeks(A4, 300, 21, 0.1, TODAY)
    expect(performance.now() - t0).toBeLessThan(50)
  })

  it('y range includes $0 and pads 10%', () => {
    expect(yRange([100, 200])).toEqual({ lo: -20, hi: 220 })
    expect(yRange([-50, 50])).toEqual({ lo: -60, hi: 60 })
  })

  it('put-call parity holds', () => {
    for (const [S, K, T, iv, r, q] of [[100, 95, 0.5, 0.3, 0.04, 0], [50, 60, 2, 0.6, 0.04, 0.02]]) {
      const lhs = bsPrice('call', S, K, T, iv, r, q) - bsPrice('put', S, K, T, iv, r, q)
      expect(lhs).toBeCloseTo(S * Math.exp(-q * T) - K * Math.exp(-r * T), 9)
    }
  })

  it('implied vol round-trips and rejects impossible premiums', () => {
    const price = bsPrice('call', 100, 110, 0.25, 0.42)
    close(impliedVol('call', 100, 110, 0.25, price), 0.42, 0.001)
    expect(impliedVol('call', 100, 110, 0.25, 150)).toBeNull()
  })

  it('covered call = shares + short call', () => {
    const lone: Position = { ...A7, strategy: 'covered_call', legs: A7.legs.filter((l) => l.kind === 'call') }
    for (const S of [40, 55, 60, 65, 80]) for (const d of [0, 10, 35]) {
      const shares = (S - 60) * 200
      expect(plAt(A7, S, d, 0.05, TODAY)).toBeCloseTo(shares + plAt(lone, S, d, 0.05, TODAY), 9)
    }
    expect(greeks(A7, 60, 35, 0, TODAY).delta).toBeCloseTo(200 + greeks(lone, 60, 35, 0, TODAY).delta, 9)
  })
})

describe('chain helpers', () => {
  const put = (strike: number, bid: number, iv: number | null): OptionContract =>
    ({ type: 'put', expiry: on(40), strike, bid, ask: bid + 0.1, last: null, iv, oi: 10, volume: 1 })

  it('picks the nearest delta; a quoted row wins only when nearly as close', () => {
    const T = 40 / 365
    const rows = [put(90, 0.2, 0.3), put(95, 0, 0.3), put(100, 2, 0.3), put(105, 4.5, 0.3), put(110, 9, 0.3)]
    expect(pickByDelta(rows, 'put', -0.3, 100, T)?.strike).toBe(95)          // 95 is nearest; 100 is far off (0.46)
    const withNear = [...rows, put(96, 0.9, 0.3)]
    expect(pickByDelta(withNear, 'put', 0.3, 100, T)?.strike).toBe(96)       // quoted 96 is nearly as close: take it
    expect(pickByDelta([], 'put', 0.3, 100, T)).toBeNull()
  })

  it('a chain with almost no quotes (before the open) does not jump to the one quoted row', () => {
    const T = 38 / 365
    const junk = [190, 200, 210, 220, 230, 240, 250].map((k) => put(k, 0, 0.03))  // Yahoo before the open: no bids, junk IVs
    const rows = [...junk, put(320, 110.25, 1.41)]
    const pick = pickByDelta(rows, 'put', 0.3, 223.8, T)
    expect(pick?.strike).toBeGreaterThanOrEqual(200)
    expect(pick?.strike).toBeLessThanOrEqual(220)
    expect(chainIsLive({ ticker: 'NVDA', expiry: on(38), underlying: 223.8, calls: [], puts: rows })).toBe(false)
    expect(chainIsLive({ ticker: 'NVDA', expiry: on(38), underlying: 223.8, calls: [], puts: [put(200, 1, 0.4), put(210, 2, 0.4), put(220, 3, 0.4)] })).toBe(true)
  })

  it('missing iv falls back to the chain median', () => {
    const rows = [put(90, 0.2, 0.2), put(95, 1, null), put(100, 2, 0.4), put(105, 4.5, 0.6)]
    expect(chainIv(rows[1], rows)).toBeCloseTo(0.4, 10)
    expect(chainIv(rows[0], rows)).toBe(0.2)
    expect(pickByDelta(rows, 'put', -0.25, 100, 40 / 365)?.strike).toBe(95)
    const position = buildPosition('csp', { ...base, spot: 100, expiry: on(40), short: rows[1] })
    cents(position.legs[0].price, 1.05)
  })

  it('warns on a zero bid but still builds', () => {
    const p = buildPosition('csp', { ...base, spot: 100, expiry: on(40), short: put(95, 0, null) })
    cents(p.legs[0].price, 0.05)
    expect(p.warnings.join(' ')).toMatch(/no bid/i)
  })

  it('a typed premium overrides the chain mid', () => {
    const p = buildPosition('csp', { ...base, spot: 100, expiry: on(40), short: put(95, 1, 0.3), premiumOverride: { short: 1.2 } })
    expect(p.legs[0].price).toBe(1.2)
  })

  it('nearest expiry', () => {
    const list = [on(-1), on(0), on(30), on(44), on(51), on(400)]
    expect(nearestExpiry(list, TODAY, 40)).toBe(on(44))
    expect(nearestExpiry(list, TODAY, 1)).toBe(on(30))
    expect(nearestExpiry([], TODAY, 40)).toBeNull()
  })
})

describe('off-hours IV, IV floor, covered call under water', () => {
  const S = 223.8
  const T = 38 / 365
  const row = (type: 'call' | 'put', strike: number, o: Partial<OptionContract> = {}): OptionContract =>
    ({ type, expiry: on(38), strike, bid: 0, ask: 0, last: null, iv: 0.03, oi: 10, volume: 1, ...o })
  const lastAt = (type: 'call' | 'put', K: number, iv: number): OptionContract =>
    row(type, K, { last: Math.round(bsPrice(type, S, K, T, iv) * 100) / 100 })
  const near = [190, 200, 210, 220, 230, 240, 250]

  it('chainIsLive needs 3 quoted rows within 15% of the stock price, not anywhere in the chain', () => {
    const far = [320, 330, 340].map((k) => row('put', k, { bid: k - S - 1, ask: k - S + 1 }))
    expect(chainIsLive({ ticker: 'X', expiry: on(38), underlying: S, calls: [], puts: [...near.map((k) => row('put', k)), ...far] })).toBe(false)
    const close3 = [210, 220, 230].map((k) => row('call', k, { bid: 5, ask: 5.4 }))
    expect(chainIsLive({ ticker: 'X', expiry: on(38), underlying: S, calls: close3, puts: [] })).toBe(true)
  })

  it('off-hours strikes use the median IV backed out of near-the-money last trades (calls and puts)', () => {
    const rows = [...near.map((k) => lastAt('put', k, 0.62)), ...near.map((k) => lastAt('call', k, 0.58)), row('put', 120, { last: 0.01 })]
    const iv = lastTradeIv(rows, S, T)
    close(iv, 0.6, 0.03)
    const expected = rows.filter((c) => c.type === 'put')
      .map((c) => ({ k: c.strike, gap: Math.abs(Math.abs(bsDelta('put', S, c.strike, T, iv as number)) - 0.3) }))
      .sort((a, b) => a.gap - b.gap)[0].k
    expect(pickByDelta(rows, 'put', 0.3, S, T)?.strike).toBe(expected)
    expect(pickerIv(rows, S, T)(rows[0])).toBe(iv)
  })

  it('off-hours with no usable last trade falls back to 40%', () => {
    const rows = near.map((k) => row('put', k))
    expect(lastTradeIv(rows, S, T)).toBeNull()
    expect(pickerIv(rows, S, T)(rows[0])).toBe(0.4)
  })

  it('a premium at intrinsic uses the chain IV, not the 1% floor (the $110 put at $10 with the stock at $100)', () => {
    const inputs: StrategyInputs = { ...base, spot: 100, expiry: on(40), short: leg(110, 10) }
    const floored = buildPosition('csp', inputs)
    expect(floored.legs[0].iv as number).toBeLessThan(IV_FLOOR_HIT)
    expect(stats(floored, 100, TODAY).chanceOfProfit as number).toBeGreaterThan(0.8)
    const fixed = buildPosition('csp', { ...inputs, ivFallback: { short: 0.5 } })
    expect(fixed.legs[0].iv).toBe(0.5)
    expect(fixed.legs[0].price).toBe(10)
    chance(stats(fixed, 100, TODAY).chanceOfProfit, 48)
    dollars(plAtExpiry(fixed, 100), 0)
    expect(buildPosition('csp', { ...A2in, ivFallback: { short: 0.9 } }).legs[0].iv).toBeCloseTo(A2.legs[0].iv as number, 10)
  })

  it('covered call bought above strike + premium: max profit is negative and equals the called-away figure', () => {
    const p = buildPosition('covered_call', { ...base, spot: 62, expiry: on(30), call: leg(65, 1), shareCost: 70 })
    const s = stats(p, 62, TODAY)
    dollars(s.maxProfit, -400)
    dollars(s.ifCalledAway, -400)
    expect(s.ifFlatPct as number).toBeLessThan(0)
  })
})
