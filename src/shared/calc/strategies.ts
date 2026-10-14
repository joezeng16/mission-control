/** Turns the inputs (typed or from a chain) into a priced Position, or field errors. */
import type { OptionContract } from '../types'
import { DEFAULT_RATE, IV_FLOOR_HIT, IV_MAX, IV_MIN, impliedVol, optionValue } from './bs'
import { daysBetween, isIsoDate } from './dates'
import {
  InputError, type FieldError, type Leg, type LegRole, type LegSource, type Position, type Strategy, type StrategyInputs
} from './types'

interface LegPlan { role: LegRole; kind: 'call' | 'put'; side: 1 | -1 }

const PLANS: Record<Strategy, LegPlan[]> = {
  csp: [{ role: 'short', kind: 'put', side: -1 }],
  put_credit_spread: [{ role: 'short', kind: 'put', side: -1 }, { role: 'long', kind: 'put', side: 1 }],
  long_call: [{ role: 'call', kind: 'call', side: 1 }],
  covered_call: [{ role: 'call', kind: 'call', side: -1 }]
}

export const MAX_DAYS = 1100
export const MAX_CONTRACTS = 1000
export const MSG = {
  spot: 'stock price must be above $0',
  days: `days to expiry must be 1-${MAX_DAYS}`,
  contracts: `contracts must be a whole number from 1 to ${MAX_CONTRACTS}`,
  iv: 'IV must be between 1% and 500%',
  rate: 'must be between 0% and 100%',
  strike: 'strike must be above $0',
  missingLeg: 'enter a strike',
  wrongType: (kind: string) => `this leg must be a ${kind}`,
  noPremium: 'type a premium',
  premium: 'premium must be above $0',
  noFit: 'premium is outside what this strike and expiry allow',
  order: 'bought strike must be below sold strike',
  credit: 'credit must be above $0 and below the strike width'
} as const

const isContract = (s: LegSource): s is OptionContract => 'type' in s && 'bid' in s
const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0
const fraction = (x: number | undefined): boolean => x === undefined || (Number.isFinite(x) && x >= 0 && x < 1)

interface Quoted { premium: number | null; warnings: string[] }

/** Chain fill: 'mid' (default), 'bid', 'ask', or a number 0..1 = how far from bid (0) to ask (1). */
function chainPremium(c: OptionContract, fill: StrategyInputs['fill']): Quoted {
  const label = `${c.strike} ${c.type}`
  const at = typeof fill === 'number' ? fill : fill === 'bid' ? 0 : fill === 'ask' ? 1 : 0.5
  const warnings = c.bid > 0 ? [] : [`No bid on the ${label}: the mid is half the ask, a real fill may be lower.`]
  const quoted = c.bid + (c.ask - c.bid) * at
  if (quoted > 0) return { premium: quoted, warnings }
  if (positive(c.last)) return { premium: c.last, warnings: [...warnings, `No live quote on the ${label}: using the last trade.`] }
  return { premium: null, warnings }
}

function typedPremium(role: LegRole, src: LegSource, i: StrategyInputs): Quoted {
  const typed = i.premiumOverride?.[role]
  if (typed !== undefined) return { premium: typed, warnings: [] }
  if (isContract(src)) return chainPremium(src, i.fill)
  return { premium: src.premium ?? null, warnings: [] }
}

function basicErrors(i: StrategyInputs): FieldError[] {
  const errors: FieldError[] = []
  if (!positive(i.spot)) errors.push({ field: 'spot', message: MSG.spot })
  const dte = isIsoDate(i.today) && isIsoDate(i.expiry) ? daysBetween(i.today, i.expiry) : NaN
  if (!(dte >= 1 && dte <= MAX_DAYS)) errors.push({ field: 'expiry', message: MSG.days })
  if (!(Number.isInteger(i.contracts) && i.contracts >= 1 && i.contracts <= MAX_CONTRACTS)) {
    errors.push({ field: 'contracts', message: MSG.contracts })
  }
  if (i.ivOverride !== undefined && !(i.ivOverride >= IV_MIN && i.ivOverride <= IV_MAX)) errors.push({ field: 'iv', message: MSG.iv })
  if (!fraction(i.rate)) errors.push({ field: 'rate', message: `rate ${MSG.rate}` })
  if (!fraction(i.dividend)) errors.push({ field: 'dividend', message: `dividend ${MSG.rate}` })
  if (i.shareCost !== undefined && !positive(i.shareCost)) errors.push({ field: 'shareCost', message: MSG.spot })
  return errors
}

interface Draft { plan: LegPlan; strike: number; premium: number | null; warnings: string[] }

function draftLeg(plan: LegPlan, i: StrategyInputs): Draft | FieldError {
  const src = i[plan.role]
  if (!src) return { field: `${plan.role}.strike`, message: MSG.missingLeg }
  if (isContract(src) && src.type !== plan.kind) return { field: `${plan.role}.strike`, message: MSG.wrongType(plan.kind) }
  if (!positive(src.strike)) return { field: `${plan.role}.strike`, message: MSG.strike }
  if (i.ivOverride !== undefined) return { plan, strike: src.strike, premium: null, warnings: [] }
  const q = typedPremium(plan.role, src, i)
  if (q.premium === null) return { field: `${plan.role}.premium`, message: MSG.noPremium }
  if (!positive(q.premium)) return { field: `${plan.role}.premium`, message: MSG.premium }
  return { plan, strike: src.strike, premium: q.premium, warnings: q.warnings }
}

function priceLeg(d: Draft, i: StrategyInputs, T: number): Leg | FieldError {
  const r = i.rate ?? DEFAULT_RATE
  const q = i.dividend ?? 0
  const base = { kind: d.plan.kind, side: d.plan.side, strike: d.strike, expiry: i.expiry }
  if (d.premium === null) {
    const iv = i.ivOverride as number
    return { ...base, iv, price: optionValue(d.plan.kind, i.spot, d.strike, T, iv, r, q) }
  }
  const solved = impliedVol(d.plan.kind, i.spot, d.strike, T, d.premium, r, q)
  if (solved === null) return { field: `${d.plan.role}.premium`, message: MSG.noFit }
  const fallback = i.ivFallback?.[d.plan.role]
  const atFloor = solved < IV_FLOOR_HIT && fallback !== undefined && fallback >= IV_FLOOR_HIT && fallback <= IV_MAX
  return { ...base, iv: atFloor ? fallback : solved, price: d.premium }
}

const isError = (x: object): x is FieldError => 'field' in x && 'message' in x

function evaluate(strategy: Strategy, i: StrategyInputs): { errors: FieldError[]; position: Position | null } {
  const errors = basicErrors(i)
  const drafts = PLANS[strategy].map((plan) => draftLeg(plan, i))
  const draftErrors = drafts.filter(isError)
  const good = drafts.filter((d): d is Draft => !isError(d))
  const [sold, bought] = good
  const orderError = strategy === 'put_credit_spread' && good.length === 2 && bought.strike >= sold.strike
    ? [{ field: 'long.strike', message: MSG.order }] : []
  const early = [...errors, ...draftErrors, ...orderError]
  if (early.length > 0) return { errors: early, position: null }

  const T = daysBetween(i.today, i.expiry) / 365
  const priced = good.map((d) => priceLeg(d, i, T))
  const priceErrors = priced.filter(isError)
  if (priceErrors.length > 0) return { errors: priceErrors, position: null }
  const legs = priced.filter((l): l is Leg => !isError(l))
  if (strategy === 'put_credit_spread') {
    const credit = legs[0].price - legs[1].price
    if (!(credit > 0 && credit < sold.strike - bought.strike)) return { errors: [{ field: 'credit', message: MSG.credit }], position: null }
  }
  const stock: Leg[] = strategy === 'covered_call'
    ? [{ kind: 'stock', side: 1, strike: null, price: i.shareCost ?? i.spot, iv: null, expiry: null }] : []
  const position: Position = {
    strategy, legs: [...legs, ...stock], contracts: i.contracts, expiry: i.expiry,
    rate: i.rate ?? DEFAULT_RATE, dividend: i.dividend ?? 0, warnings: good.flatMap((d) => d.warnings)
  }
  return { errors: [], position }
}

/** Every inline error for these inputs ([] = valid). Cheap enough to call on each keystroke. */
export function validateInputs(strategy: Strategy, i: StrategyInputs): FieldError[] {
  return evaluate(strategy, i).errors
}

/** A priced position; throws InputError (with .errors) when inputs are invalid, so the UI keeps the last valid chart. */
export function buildPosition(strategy: Strategy, i: StrategyInputs): Position {
  const { errors, position } = evaluate(strategy, i)
  if (!position) throw new InputError(errors)
  return position
}
