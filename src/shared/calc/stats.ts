/** The stats card: money, outcomes and odds per entry type. */
import { IV_MIN, intrinsic, normCdf } from './bs'
import { MULTIPLIER, breakevens, daysToExpiry, isOptionLeg, plAtExpiry, strikes } from './payoff'
import type { LegStat, Position, Stats } from './types'

const LEAPS_DAYS = 365

/** IV of the option leg whose strike is nearest X (the sold leg wins a tie). */
function ivNear(p: Position, X: number): number {
  const legs = p.legs.filter(isOptionLeg)
  const best = legs.reduce((a, b) => (Math.abs(b.strike - X) < Math.abs(a.strike - X) ? b : a), legs[0])
  return best?.iv ?? IV_MIN
}

/** Risk-neutral lognormal P(finish above X) = N(d2). */
function probAbove(p: Position, spot: number, T: number, X: number): number {
  if (X <= 0) return 1
  if (T <= 0) return spot > X ? 1 : 0
  const iv = ivNear(p, X)
  return normCdf((Math.log(spot / X) + (p.rate - p.dividend - iv * iv / 2) * T) / (iv * Math.sqrt(T)))
}

/** Sum of the probabilities of every price band (between breakevens) where the expiry P/L is above $0. */
function chanceOfProfit(p: Position, spot: number, T: number, bes: number[]): number {
  const edges = [0, ...bes, Infinity]
  let total = 0
  for (let k = 0; k + 1 < edges.length; k++) {
    const [a, b] = [edges[k], edges[k + 1]]
    const probe = b === Infinity ? a + Math.max(1, a) : (a + b) / 2
    if (plAtExpiry(p, probe) > 0) total += probAbove(p, spot, T, a) - (b === Infinity ? 0 : probAbove(p, spot, T, b))
  }
  return Math.min(1, Math.max(0, total))
}

/** Best and worst expiry P/L: checked at $0, every strike, and the slope past the top strike. The best can be below $0
 *  (a covered call on shares bought above strike + premium); the worst is never above $0. */
function extremes(p: Position): { maxProfit: number | 'unlimited'; maxLoss: number | 'unlimited' } {
  const xs = [0, ...strikes(p)]
  const ys = xs.map((x) => plAtExpiry(p, x))
  const top = xs[xs.length - 1]
  const slope = plAtExpiry(p, top + 1) - plAtExpiry(p, top)
  return {
    maxProfit: slope > 1e-9 ? 'unlimited' : Math.max(...ys),
    maxLoss: slope < -1e-9 ? 'unlimited' : Math.min(0, ...ys)
  }
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null)
const perYear = (r: number | null, dte: number): number | null => (r === null || dte <= 0 ? null : (r * 365) / dte)

export function stats(p: Position, spot: number, today: string): Stats {
  const dte = daysToExpiry(p, today)
  const units = MULTIPLIER * p.contracts
  const options = p.legs.filter(isOptionLeg)
  const sold = options.find((l) => l.side === -1) ?? null
  const netPremium = options.reduce((s, l) => s - l.side * l.price, 0)
  const premiumTotal = netPremium * units
  const { maxProfit, maxLoss } = extremes(p)
  const bes = breakevens(p)
  const legs: LegStat[] = options.map((l) => ({
    kind: l.kind, side: l.side, strike: l.strike, premium: l.price, iv: l.iv ?? IV_MIN,
    moneyness: intrinsic(l.kind, spot, l.strike) > 0 ? 'ITM' : 'OTM'
  }))
  const out: Stats = {
    strategy: p.strategy, daysToExpiry: dte, leaps: false, netPremium, premiumTotal, cash: 0, width: null,
    maxProfit, maxLoss, breakevens: bes, breakevenPct: bes.length > 0 ? (bes[0] - spot) / spot : null,
    returnOnCash: null, perYear: null, cushion: null,
    chanceOfProfit: chanceOfProfit(p, spot, dte / 365, bes),
    chanceOfMaxProfit: maxProfit === 'unlimited' || !sold ? null : probAbove(p, spot, dte / 365, sold.strike),
    intrinsic: null, extrinsic: null, ifCalledAway: null, ifCalledAwayPct: null, ifFlat: null, ifFlatPct: null, legs
  }
  return { ...out, ...byStrategy(p, out, spot, units) }
}

function byStrategy(p: Position, s: Stats, spot: number, units: number): Partial<Stats> {
  const options = p.legs.filter(isOptionLeg)
  const dte = s.daysToExpiry
  if (p.strategy === 'csp') {
    const K = options[0].strike
    const returnOnCash = s.netPremium / K
    const cushion = s.breakevens.length > 0 ? (spot - s.breakevens[0]) / spot : null
    return { cash: K * units, returnOnCash, perYear: perYear(returnOnCash, dte), cushion }
  }
  if (p.strategy === 'put_credit_spread') {
    const cash = s.maxLoss === 'unlimited' ? 0 : -s.maxLoss
    const returnOnCash = ratio(s.premiumTotal, cash)
    return { cash, width: options[0].strike - options[1].strike, returnOnCash, perYear: perYear(returnOnCash, dte) }
  }
  if (p.strategy === 'long_call') {
    const own = intrinsic('call', spot, options[0].strike)
    return { cash: -s.premiumTotal, intrinsic: own, extrinsic: options[0].price - own, leaps: dte >= LEAPS_DAYS }
  }
  const shareCost = p.legs.find((l) => l.kind === 'stock')?.price ?? spot
  const netCost = (shareCost - s.netPremium) * units
  const ifCalledAway = (options[0].strike - shareCost + s.netPremium) * units
  const ifFlat = plAtExpiry(p, spot)
  const ifFlatPct = ratio(ifFlat, netCost)
  return {
    cash: netCost, ifCalledAway, ifCalledAwayPct: ratio(ifCalledAway, netCost), ifFlat, ifFlatPct,
    returnOnCash: ifFlatPct, perYear: perYear(ifFlatPct, dte)
  }
}
