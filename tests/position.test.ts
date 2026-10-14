import { describe, expect, it } from 'vitest'
import { addDays, bsPrice, pickByDelta, stats } from '../src/shared/calc'
import type { Chain, Level, OptionContract } from '../src/shared/types'
import type { CalcRequest } from '../src/renderer/src/lib/calcRequest'
import { isLoss, localToday, money } from '../src/renderer/src/lib/format'
import {
  TYPED, buildPosition, contextFor, defaultPicks, ivFor, offHoursIv, pricing, switchPicks, takeProfitOf, type BuildInput, type Picks
} from '../src/renderer/src/lib/position'

const TODAY = '2026-10-13'
const EXP = addDays(TODAY, 38)
const T = 38 / 365
const S = 100
const IV = 0.45
const STRIKES = Array.from({ length: 33 }, (_, k) => 60 + k * 2.5)    // $60 … $140
const cents = (x: number): number => Math.round(x * 100) / 100

function row(type: 'call' | 'put', K: number, live: boolean, iv = IV, expiry = EXP): OptionContract {
  const p = bsPrice(type, S, K, T, iv)
  const bid = live ? cents(p * 0.97) : 0
  const ask = live ? cents(p * 1.03 + 0.01) : 0
  return { type, expiry, strike: K, bid, ask, last: cents(p) || null, iv: live ? iv : 0.03, oi: 100, volume: 10 }
}

function chainOf(live = true, iv = IV, expiry = EXP): Chain {
  return {
    ticker: 'TEST', expiry, underlying: S,
    calls: STRIKES.map((K) => row('call', K, live, iv, expiry)),
    puts: STRIKES.map((K) => row('put', K, live, iv, expiry))
  }
}

function request(level: Level, live: boolean, strike: number | null = null, expiry: string | null = null): CalcRequest {
  return { ticker: 'TEST', strike, expiry, level, live, tested: null, buyback: null, wingStrike: null, nonce: 1 }
}

const rowsOf = (c: Chain): OptionContract[] => [...c.puts, ...c.calls]
const deltaPut = (c: Chain, d: number): number | undefined => pickByDelta(rowsOf(c), 'put', d, S, T)?.strike
const base = (over: Partial<BuildInput>): BuildInput =>
  ({ strategy: 'csp', chain: chainOf(), picks: { short: 95, long: 90, call: 105 }, contracts: 1, fill: null, shareCost: null, today: TODAY, ...over })

describe('level-aware strike picks', () => {
  const chain = chainOf()

  it('a typed ticker sells the 0.30 delta put', () => {
    expect(contextFor(null)).toBe(TYPED)
    expect(defaultPicks('csp', chain, TODAY).short).toBe(deltaPut(chain, 0.3))
  })

  it('a signal without a live quote picks by its level: 3/3 0.30, 2/3 0.20, 1/3 0.15', () => {
    const pick = (level: Level): number | null => defaultPicks('csp', chain, TODAY, contextFor(request(level, false, 92.5, EXP))).short
    expect(pick(3)).toBe(deltaPut(chain, 0.3))
    expect(pick(2)).toBe(deltaPut(chain, 0.2))
    expect(pick(1)).toBe(deltaPut(chain, 0.15))
    expect(pick(1) as number).toBeLessThan(pick(3) as number)
  })

  it("a live signal keeps the scanner's own strike on its expiry, and falls back to the level delta on another expiry", () => {
    const ctx = contextFor(request(1, true, 92.5, EXP))
    expect(defaultPicks('csp', chain, TODAY, ctx).short).toBe(92.5)
    const other = chainOf(true, IV, addDays(TODAY, 45))
    expect(defaultPicks('csp', other, TODAY, ctx).short).toBe(pickByDelta(rowsOf(other), 'put', 0.15, S, 45 / 365)?.strike)
  })

  it("a live signal's strike far from today's price (stale scan, example data) is ignored: the level delta is used", () => {
    const above = contextFor(request(1, true, 105, EXP))                 // a sold put above the stock
    expect(defaultPicks('csp', chain, TODAY, above).short).toBe(deltaPut(chain, 0.15))
    const moved = { ...chain, underlying: 200 }                           // the stock is now twice the scan's price
    const old = contextFor(request(1, true, 92.5, EXP))
    expect(defaultPicks('csp', moved, TODAY, old).short).not.toBe(92.5)
    expect(defaultPicks('csp', chain, TODAY, old).short).toBe(92.5)      // still in range: kept
  })

  it("the spread sells the same put and buys the 0.10 delta wing below it (or the next strike down)", () => {
    const ctx = contextFor(request(2, false))
    const p = defaultPicks('put_credit_spread', chain, TODAY, ctx)
    expect(p.short).toBe(deltaPut(chain, 0.2))
    expect(p.long).toBe(deltaPut(chain, 0.1))
    expect(p.long as number).toBeLessThan(p.short as number)
    const deep = defaultPicks('put_credit_spread', chain, TODAY, contextFor(request(3, true, 70, EXP)))
    expect(deep).toMatchObject({ short: 70, long: 67.5 })
  })

  it("a live signal's spread buys the scanner's own wing on its expiry (else the 0.10 delta put)", () => {
    const ctx = contextFor({ ...request(1, true, 92.5, EXP), wingStrike: 85 })
    expect(defaultPicks('put_credit_spread', chain, TODAY, ctx)).toMatchObject({ short: 92.5, long: 85 })
    const other = chainOf(true, IV, addDays(TODAY, 45))
    const elsewhere = defaultPicks('put_credit_spread', other, TODAY, ctx)
    expect(elsewhere.long).toBe(pickByDelta(rowsOf(other), 'put', 0.1, S, 45 / 365)?.strike)
    expect(defaultPicks('put_credit_spread', chain, TODAY, contextFor({ ...request(1, true, 92.5, EXP), wingStrike: 95 })).long).toBeLessThan(92.5)   // a wing above the sold put is ignored
  })

  it("switching trade type keeps the signal's sold put (no reset to 0.30)", () => {
    const ctx = contextFor(request(1, true, 92.5, EXP))
    const csp: Picks = defaultPicks('csp', chain, TODAY, ctx)
    const spread = switchPicks(csp, 'put_credit_spread', chain, TODAY, ctx)
    expect(spread.short).toBe(92.5)
    expect(spread.long as number).toBeLessThan(92.5)
    const covered = switchPicks(spread, 'covered_call', chain, TODAY, ctx)
    expect(covered.call).toBe(pickByDelta(rowsOf(chain), 'call', 0.3, S, T)?.strike)
    expect(switchPicks(covered, 'csp', chain, TODAY, ctx).short).toBe(92.5)
    const typed = switchPicks({ short: 87.5, long: 80, call: null }, 'put_credit_spread', chain, TODAY, TYPED)
    expect(typed).toMatchObject({ short: 87.5, long: 80 })
  })
})

describe('take profit at 50%', () => {
  it('cash-secured put: buy back at half the premium', () => {
    const r = buildPosition(base({ fill: 2.15, contracts: 2 }))
    const tp = takeProfitOf('csp', r.built!.position)!
    expect(tp.buyBack).toBe(1.08)
    expect(tp.profit).toBeCloseTo((2.15 - 1.08) * 200, 9)
  })

  it('put credit spread: half the net credit', () => {
    const r = buildPosition(base({ strategy: 'put_credit_spread', fill: 1.4 }))
    const tp = takeProfitOf('put_credit_spread', r.built!.position)!
    expect(tp.premium).toBeCloseTo(1.4, 9)
    expect(tp.buyBack).toBe(0.7)
    expect(tp.profit).toBeCloseTo(70, 9)
  })

  it('covered call uses the call premium; a long call has none', () => {
    const cc = buildPosition(base({ strategy: 'covered_call', fill: 1.9 }))
    expect(takeProfitOf('covered_call', cc.built!.position)).toMatchObject({ buyBack: 0.95 })
    const lc = buildPosition(base({ strategy: 'long_call' }))
    expect(takeProfitOf('long_call', lc.built!.position)).toBeNull()
  })
})

describe('error messages reach the UI in plain words', () => {
  it('wing at or above the sold strike', () => {
    const r = buildPosition(base({ strategy: 'put_credit_spread', picks: { short: 95, long: 97.5, call: null } }))
    expect(r.built).toBeNull()
    expect(r.error).toBe('Pick a wing strike below the strike you sell ($95).')
  })

  it('a missing strike', () => {
    expect(buildPosition(base({ picks: { short: null, long: null, call: null } })).error).toBe('Pick a strike for the put you sell.')
  })

  it('a typed price below what the option is worth today', () => {
    const r = buildPosition(base({ picks: { short: 110, long: null, call: null }, fill: 1 }))
    expect(r.error).toMatch(/\$110 put you sell \(\$1\.00\) is below what it's worth if used today \(\$10\.00\)/)
  })

  it('a typed price higher than the strike allows', () => {
    expect(buildPosition(base({ fill: 150 })).error).toMatch(/higher than this strike and date allow/)
  })

  it('a credit wider than the strikes', () => {
    const r = buildPosition(base({ strategy: 'put_credit_spread', fill: 6 }))
    expect(r.error).toMatch(/What you collect must be above \$0 and less than the gap between the strikes \(\$5\.00\)/)
  })

  it('an expiry that is today', () => {
    expect(buildPosition(base({ chain: chainOf(true, IV, TODAY), picks: { short: 95, long: null, call: null } })).error)
      .toBe('Pick an expiration at least 1 day out.')
  })
})

describe('stale quotes and model prices', () => {
  it('a mid below intrinsic falls back to intrinsic + a little time value instead of failing', () => {
    const chain = chainOf()
    const stale = { ...row('put', 110, true), bid: 8.9, ask: 9.1 }                   // mid $9.00 < intrinsic $10.00
    const c = { ...chain, puts: chain.puts.map((p) => (p.strike === 110 ? stale : p)) }
    const p = pricing(stale, c, TODAY)
    expect(p.price).toBeGreaterThanOrEqual(10.05)
    expect(p.note).toMatch(/stale/)
    const r = buildPosition(base({ chain: c, picks: { short: 110, long: null, call: null } }))
    expect(r.error).toBeNull()
    expect(r.built?.notes.join(' ')).toMatch(/stale/)
  })

  it('a model price (no quote, no last trade) is never below intrinsic', () => {
    const chain = chainOf(false)
    const bare = { ...row('put', 130, false), last: null }
    expect(pricing(bare, chain, TODAY).price).toBeGreaterThanOrEqual(30.01)
  })

  it('a premium at intrinsic uses the chain IV for the odds, not 1%', () => {
    const chain = chainOf()
    const r = buildPosition(base({ chain, picks: { short: 110, long: null, call: null }, fill: 10 }))
    const leg = r.built!.position.legs[0]
    expect(leg.iv).toBeCloseTo(IV, 9)
    expect(r.built!.notes.join(' ')).toMatch(/chain's 45% IV/)
    const odds = stats(r.built!.position, S, TODAY).chanceOfProfit as number
    expect(odds).toBeGreaterThan(0.4)
    expect(odds).toBeLessThan(0.55)
  })
})

describe('off-hours chain', () => {
  it('places strikes with the IV backed out of near-the-money last trades, and the hint uses the same IV', () => {
    const chain = chainOf(false, 0.6)
    const off = offHoursIv(chain, TODAY)!
    expect(off.fromTrades).toBe(true)
    expect(off.iv).toBeGreaterThan(0.57)
    expect(off.iv).toBeLessThan(0.63)
    expect(ivFor(chain, TODAY)(chain.puts[0])).toBeCloseTo(off.iv, 9)
    const at60 = pickByDelta(rowsOf(chainOf(true, 0.6)), 'put', 0.3, S, T)?.strike
    expect(defaultPicks('csp', chain, TODAY).short).toBe(at60)
  })

  it('no usable last trades = the 40% fallback', () => {
    const chain = chainOf(false)
    const bare = { ...chain, puts: chain.puts.map((p) => ({ ...p, last: null })), calls: chain.calls.map((c) => ({ ...c, last: null })) }
    expect(offHoursIv(bare, TODAY)).toEqual({ iv: 0.4, fromTrades: false })
    expect(offHoursIv(chainOf(true), TODAY)).toBeNull()
  })
})

describe('dates and signs', () => {
  it("counts days from your own calendar date, not New York's", () => {
    const thursdayNight = new Date('2026-10-16T04:30:00Z')    // Thu Oct 15, 11:30 PM in Chicago = Fri 12:30 AM in New York
    expect(localToday(thursdayNight, 'America/Chicago')).toBe('2026-10-15')
    expect(localToday(thursdayNight, 'America/New_York')).toBe('2026-10-16')
    expect(localToday(thursdayNight)).toMatch(/^\d{4}-\d{2}-\d{2}$/)   // this computer's own zone
  })

  it('rounds before the sign: a tiny loss reads $0 in the profit color', () => {
    expect(money(-0.3, { sign: true })).toBe('$0')
    expect(money(-0.004, { decimals: 2, sign: true })).toBe('$0.00')
    expect(isLoss(-0.3)).toBe(false)
    expect(money(-0.6)).toBe('−$1')
    expect(isLoss(-0.6)).toBe(true)
  })
})
