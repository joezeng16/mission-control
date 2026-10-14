/** Calculator data model. Money is dollars, ratios and IVs are fractions (0.35 = 35%). */
import type { OptionContract } from '../types'

export type Strategy = 'csp' | 'put_credit_spread' | 'long_call' | 'covered_call'

/** One leg. `price` is the entry premium per share, unrounded (stock: the share cost). Quantity is 100 x contracts. */
export interface Leg {
  kind: 'call' | 'put' | 'stock'
  side: 1 | -1
  strike: number | null
  price: number
  iv: number | null
  expiry: string | null
}

export interface Position {
  strategy: Strategy
  legs: Leg[]
  contracts: number
  expiry: string
  rate: number
  dividend: number
  warnings: string[]
}

/** A leg typed by hand: strike plus (premium mode) the premium per share. */
export interface ManualLeg { strike: number; premium?: number | null }
export type LegSource = OptionContract | ManualLeg
export type LegRole = 'short' | 'long' | 'call'

/** Legs per strategy: csp = short put; put_credit_spread = short put + long (bought, lower) put;
 *  long_call = call (bought); covered_call = call (sold) + 100 x contracts shares at shareCost (default spot).
 *  IV mode: set ivOverride (one IV for all legs); premiums become model values.
 *  Premium mode: premiumOverride > chain fill (default mid) > ManualLeg.premium; IVs are back-solved (ivFallback replaces
 *  an IV that lands at the floor). */
export interface StrategyInputs {
  spot: number
  contracts: number
  expiry: string
  today: string
  short?: LegSource
  long?: LegSource
  call?: LegSource
  shareCost?: number
  fill?: 'mid' | 'bid' | 'ask' | number
  ivOverride?: number
  premiumOverride?: Partial<Record<LegRole, number>>
  /** IV to use for a leg whose premium back-solves to the floor (premium ~ intrinsic): the chain's IV, not 1%. */
  ivFallback?: Partial<Record<LegRole, number>>
  rate?: number
  dividend?: number
}

/** `field` is spot | expiry | contracts | iv | rate | dividend | shareCost | credit | <role>.strike | <role>.premium */
export interface FieldError { field: string; message: string }

export class InputError extends Error {
  readonly errors: FieldError[]
  constructor(errors: FieldError[]) {
    super(errors.map((e) => `${e.field}: ${e.message}`).join('; '))
    this.name = 'InputError'
    this.errors = errors
  }
}

/** Position Greeks in dollars: delta and gamma in shares, theta $ per calendar day, vega $ per 1 IV point. */
export interface Greeks { delta: number; gamma: number; theta: number; vega: number }

export interface LegStat {
  kind: 'call' | 'put'
  side: 1 | -1
  strike: number
  premium: number
  iv: number
  moneyness: 'ITM' | 'OTM'
}

/** maxLoss <= 0 (as P/L); maxProfit is the best expiry P/L (below $0 only for a covered call whose share cost is above
 *  strike + premium); breakevens [] = none. Ratios are fractions; null = not shown for this type. */
export interface Stats {
  strategy: Strategy
  daysToExpiry: number
  leaps: boolean
  netPremium: number
  premiumTotal: number
  cash: number
  width: number | null
  maxProfit: number | 'unlimited'
  maxLoss: number | 'unlimited'
  breakevens: number[]
  breakevenPct: number | null
  returnOnCash: number | null
  perYear: number | null
  cushion: number | null
  chanceOfProfit: number | null
  chanceOfMaxProfit: number | null
  intrinsic: number | null
  extrinsic: number | null
  ifCalledAway: number | null
  ifCalledAwayPct: number | null
  ifFlat: number | null
  ifFlatPct: number | null
  legs: LegStat[]
}
