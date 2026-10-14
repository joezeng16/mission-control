/** Turns the calculator's picks (strategy, strikes, fill) into a Position for the math module. */
import type { Chain, Level, OptionContract, Tested } from '@shared/types'
import {
  FALLBACK_IV, InputError, MULTIPLIER, buildPosition as buildCalc, chainIsLive, intrinsic, lastTradeIv, optionValue, pickByDelta,
  pickerIv, type FieldError, type LegRole, type Position, type StrategyInputs
} from '@shared/calc'
import { LEVEL_DELTA, TAKE_PROFIT_LEFT, TYPED_PUT_DELTA, WING_DELTA } from '@shared/defaults'
import type { CalcRequest } from './calcRequest'
import { daysBetween, dec2, fmtDate, strike as fmtStrike } from './format'

export type Strategy = 'csp' | 'put_credit_spread' | 'long_call' | 'covered_call'

export const STRATEGIES: { value: Strategy; label: string; blurb: string }[] = [
  { value: 'csp', label: 'Cash-secured put', blurb: 'Get paid to maybe buy the stock lower' },
  { value: 'put_credit_spread', label: 'Put credit spread', blurb: 'A put with a cap on the loss' },
  { value: 'long_call', label: 'Long call / LEAPS', blurb: 'Bet on the stock going up' },
  { value: 'covered_call', label: 'Covered call', blurb: 'Own 100 shares, get paid to sell higher' }
]

export interface Picks {
  short: number | null
  long: number | null
  call: number | null
}

export const NO_PICKS: Picks = { short: null, long: null, call: null }

/** Where default strikes come from: a typed ticker (TYPED_PUT_DELTA put) or a scanner signal (its level's delta, or the
 *  scanner's own strike/expiry when its quote was live). */
export interface PickContext {
  putDelta: number
  /** The scanner's live sold put and, for the spread, its bought put (wing) on that expiry. */
  anchor: { strike: number; expiry: string; wing: number | null } | null
  level: Level | null
  tested: Tested | null
}

const LONG_CALL_DELTA = 0.75
const COVERED_CALL_DELTA = 0.3
const MIN_TIME_VALUE = 0.01     // a model price is never below intrinsic + 1 cent
const STALE_TIME_VALUE = 0.05   // a quote below intrinsic (stale) is replaced by at least intrinsic + 5 cents

export const TYPED: PickContext = { putDelta: TYPED_PUT_DELTA, anchor: null, level: null, tested: null }

export function contextFor(req: CalcRequest | null): PickContext {
  if (!req) return TYPED
  const anchor = req.live && req.strike != null && req.expiry ? { strike: req.strike, expiry: req.expiry, wing: req.wingStrike ?? null } : null
  return { putDelta: LEVEL_DELTA[req.level] ?? TYPED_PUT_DELTA, anchor, level: req.level ?? null, tested: req.tested ?? null }
}

export function mid(c: OptionContract): number {
  if (c.bid > 0 && c.ask > 0) return (c.bid + c.ask) / 2
  return c.last ?? Math.max(c.ask, c.bid, 0)
}

export function spreadPct(c: OptionContract): number | null {
  const m = mid(c)
  return m > 0 && c.ask > 0 ? (c.ask - c.bid) / m : null
}

export function yearsLeft(expiry: string, today: string): number {
  return Math.max(daysBetween(today, expiry), 0.5) / 365
}

const rowsOf = (chain: Chain): OptionContract[] => [...chain.puts, ...chain.calls]

/** The IV the strike picker uses for each row; the dropdown's odds hint and model prices use the same one. */
export function ivFor(chain: Chain, today: string): (c: OptionContract) => number | null {
  return pickerIv(rowsOf(chain), chain.underlying, yearsLeft(chain.expiry, today))
}

/** When the chain is not live: the IV strikes are placed with, and whether it came from last trades (else the 40% fallback). */
export function offHoursIv(chain: Chain, today: string): { iv: number; fromTrades: boolean } | null {
  if (chainIsLive(chain)) return null
  const fromTrades = lastTradeIv(rowsOf(chain), chain.underlying, yearsLeft(chain.expiry, today))
  return { iv: fromTrades ?? FALLBACK_IV, fromTrades: fromTrades !== null }
}

function modelPrice(c: OptionContract, chain: Chain, today: string): number {
  const iv = ivFor(chain, today)(c) ?? FALLBACK_IV
  const own = intrinsic(c.type, chain.underlying, c.strike)
  return Math.max(optionValue(c.type, chain.underlying, c.strike, yearsLeft(c.expiry, today), iv), own + MIN_TIME_VALUE)
}

interface Priced { price: number; note: string | null }

/** The mid when quoted, else the last trade, else a model estimate. A quote below what the option is worth if exercised
 *  now is stale: it is replaced by intrinsic + a small time value (or the model price, if higher). */
export function pricing(c: OptionContract, chain: Chain, today: string): Priced {
  const m = mid(c)
  if (!(m > 0)) return { price: modelPrice(c, chain, today), note: null }
  const own = intrinsic(c.type, chain.underlying, c.strike)
  if (m >= own) return { price: m, note: null }
  const price = Math.max(modelPrice(c, chain, today), own + STALE_TIME_VALUE)
  return {
    price,
    note: `The $${fmtStrike(c.strike)} ${c.type}'s quote ($${dec2(m)}) is below what it's worth if used today ($${dec2(own)}), so it is stale. The calculator uses $${dec2(price)}. Check your broker.`
  }
}

export function priceOf(c: OptionContract, chain: Chain, today: string): number {
  return pricing(c, chain, today).price
}

const has = (list: OptionContract[], k: number | null): k is number => k != null && list.some((c) => c.strike === k)

/** The scanner's own strike, when its quote was live and the calculator is on the scanner's expiry. */
// A scan's sold put is only reused while it still makes sense at today's price: not above the stock, and not more than
// 40% below it. Outside that band the scan is stale (an old file, or the example scanner's made-up prices), so the
// calculator picks by delta from the live chain instead.
const SIGNAL_STRIKE_MIN = 0.6
const SIGNAL_STRIKE_MAX = 1.0

function signalStrike(chain: Chain, ctx: PickContext): number | null {
  const a = ctx.anchor
  if (!a || a.expiry !== chain.expiry || !has(chain.puts, a.strike)) return null
  const ratio = a.strike / chain.underlying
  return ratio >= SIGNAL_STRIKE_MIN && ratio <= SIGNAL_STRIKE_MAX ? a.strike : null
}

/** The scanner's own wing, when the calculator is on its sold put and expiry and the chain has that strike below it. */
function signalWing(chain: Chain, ctx: PickContext, short: number | null): number | null {
  const a = ctx.anchor
  if (!a || a.wing == null || short == null || a.expiry !== chain.expiry || a.strike !== short) return null
  return has(chain.puts, a.wing) && a.wing < short ? a.wing : null
}

/** The spread's bought put: the WING_DELTA put when it is below the sold strike, else the next strike below. */
export function wingFor(chain: Chain, short: number | null, today: string): number | null {
  if (short == null) return null
  const wing = pickByDelta(rowsOf(chain), 'put', WING_DELTA, chain.underlying, yearsLeft(chain.expiry, today))?.strike
  if (wing != null && wing < short) return wing
  const below = chain.puts.map((c) => c.strike).filter((k) => k < short)
  return below.length > 0 ? Math.max(...below) : null
}

/** Default strikes. Sold put: the signal's live strike, else its level's delta (typed ticker: 0.30); wing: the signal's
 *  live wing, else 0.10 delta; call: 0.75 delta to buy, 0.30 to sell. */
export function defaultPicks(strategy: Strategy, chain: Chain, today: string, ctx: PickContext = TYPED): Picks {
  const T = yearsLeft(chain.expiry, today)
  const S = chain.underlying
  const rows = rowsOf(chain)
  const short = signalStrike(chain, ctx) ?? pickByDelta(rows, 'put', ctx.putDelta, S, T)?.strike ?? null
  const callDelta = strategy === 'long_call' ? LONG_CALL_DELTA : COVERED_CALL_DELTA
  const long = signalWing(chain, ctx, short) ?? wingFor(chain, short, today)
  return { short, long, call: pickByDelta(rows, 'call', callDelta, S, T)?.strike ?? null }
}

function carryPuts(prev: Picks, chain: Chain, today: string, fallback: Picks): Pick<Picks, 'short' | 'long'> {
  const short = has(chain.puts, prev.short) ? prev.short : fallback.short
  const long = has(chain.puts, prev.long) && short != null && prev.long < short ? prev.long : wingFor(chain, short, today)
  return { short, long }
}

/** New trade type on the same chain: the sold put and wing carry over (the signal's strike stays); the call is re-picked
 *  because a bought call and a sold call sit at different deltas. */
export function switchPicks(prev: Picks, to: Strategy, chain: Chain, today: string, ctx: PickContext = TYPED): Picks {
  const d = defaultPicks(to, chain, today, ctx)
  return { ...carryPuts(prev, chain, today, d), call: d.call }
}

/** New expiry: keep the strikes you chose when they exist in the new chain; fill gaps with defaults. */
export function keepPicks(prev: Picks, strategy: Strategy, chain: Chain, today: string, ctx: PickContext = TYPED): Picks {
  const d = defaultPicks(strategy, chain, today, ctx)
  return { ...carryPuts(prev, chain, today, d), call: has(chain.calls, prev.call) ? prev.call : d.call }
}

export interface TakeProfit { premium: number; buyBack: number; profit: number }

/** The take-profit rule on credit trades: a good-till-canceled buy-back at TAKE_PROFIT_LEFT of what you collected (spread: the net)
 *  per share; `profit` = what you keep if it fills. null for a long call. */
export function takeProfitOf(strategy: Strategy, position: Position): TakeProfit | null {
  if (strategy === 'long_call') return null
  const premium = position.legs.filter((l) => l.kind !== 'stock').reduce((s, l) => s - l.side * l.price, 0)
  if (!(premium > 0)) return null
  const buyBack = Math.round(premium * TAKE_PROFIT_LEFT * 100 + 1e-9) / 100
  return { premium, buyBack, profit: (premium - buyBack) * MULTIPLIER * position.contracts }
}

export interface LegView {
  label: string
  contract: OptionContract | null
}

export interface Built {
  /** Legs priced without a live bid/ask, in plain words (shown above the graph). */
  warnings: string[]
  /** Stale quotes replaced, IVs taken from the chain: shown even when the whole chain is off-hours. */
  notes: string[]
  position: Position
  legs: LegView[]
  defaultFill: number
  fillLabel: string
  strikes: number[]
}

export type BuildResult = { built: Built; error: null } | { built: null; error: string }

export interface BuildInput {
  strategy: Strategy
  chain: Chain
  picks: Picks
  contracts: number
  fill: number | null
  shareCost: number | null
  today: string
}

interface PlannedLeg { role: LegRole; action: 'Sell' | 'Buy'; contract: OptionContract | null }

const find = (list: OptionContract[], k: number | null): OptionContract | null => list.find((c) => c.strike === k) ?? null

function planLegs(strategy: Strategy, chain: Chain, picks: Picks): PlannedLeg[] {
  if (strategy === 'csp') return [{ role: 'short', action: 'Sell', contract: find(chain.puts, picks.short) }]
  if (strategy === 'put_credit_spread') {
    return [
      { role: 'short', action: 'Sell', contract: find(chain.puts, picks.short) },
      { role: 'long', action: 'Buy', contract: find(chain.puts, picks.long) }
    ]
  }
  return [{ role: 'call', action: strategy === 'long_call' ? 'Buy' : 'Sell', contract: find(chain.calls, picks.call) }]
}

const SUBJECT: Record<Strategy, Partial<Record<LegRole, string>>> = {
  csp: { short: 'put you sell' },
  put_credit_spread: { short: 'put you sell', long: 'wing (the put you buy)' },
  long_call: { call: 'call you buy' },
  covered_call: { call: 'call you sell' }
}

const FILL_LABEL: Record<Strategy, string> = {
  csp: 'Collected', put_credit_spread: 'Collected', long_call: 'Price you pay', covered_call: 'Collected'
}

function missingMessage(strategy: Strategy, role: LegRole, picks: Picks): string {
  if (role === 'long' && picks.short != null) return `Pick a wing strike below the strike you sell ($${fmtStrike(picks.short)}).`
  return `Pick a strike for the ${SUBJECT[strategy][role] ?? 'option'}.`
}

interface ErrorInfo { strategy: Strategy; legs: PlannedLeg[]; premium: Partial<Record<LegRole, number>>; spot: number }

/** One InputError field in plain words. */
export function plainError(e: FieldError, info: ErrorInfo): string {
  const [role, part] = e.field.split('.') as [string, string | undefined]
  const leg = info.legs.find((l) => l.role === role)?.contract ?? null
  const subject = SUBJECT[info.strategy][role as LegRole] ?? 'option'
  const what = leg ? `the $${fmtStrike(leg.strike)} ${subject}` : `the ${subject}`
  if (e.field === 'expiry') return 'Pick an expiration at least 1 day out.'
  if (e.field === 'contracts') return 'Contracts must be a whole number from 1 to 1,000.'
  if (e.field === 'spot') return 'No stock price yet. Load the ticker again.'
  if (e.field === 'shareCost') return 'Your share cost must be above $0.'
  if (e.field === 'credit') {
    const [s, l] = info.legs.map((x) => x.contract?.strike ?? 0)
    return `What you collect must be above $0 and less than the gap between the strikes ($${dec2(s - l)}). Change the price.`
  }
  if (part === 'premium' && leg) {
    const typed = info.premium[role as LegRole] ?? 0
    const own = intrinsic(leg.type, info.spot, leg.strike)
    if (!(typed > 0)) return `Type a price above $0 for ${what}.`
    if (typed < own) return `The price for ${what} ($${dec2(typed)}) is below what it's worth if used today ($${dec2(own)}). Type at least $${dec2(own)}.`
    return `The price for ${what} ($${dec2(typed)}) is higher than this strike and date allow. Type a lower price.`
  }
  if (e.field === 'long.strike') return `Pick a wing strike below the strike you sell.`
  const text = `${what}: ${e.message}.`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function legLabel(action: 'Sell' | 'Buy', n: number, ticker: string, c: OptionContract): string {
  return `${action} ${n} ${ticker} ${fmtDate(c.expiry)} $${fmtStrike(c.strike)} ${c.type}`
}

function quoteWarnings(cs: OptionContract[], fill: number | null): string[] {
  if (fill != null) return []                                    // a price typed by hand
  return cs.filter((c) => !(c.bid > 0 && c.ask > 0)).map((c) =>
    `No live bid/ask for the $${fmtStrike(c.strike)} ${c.type}: its price is ${c.last != null && c.last > 0 ? 'the last trade' : 'an estimate'}. Check your broker.`)
}

function floorNotes(position: Position, legs: PlannedLeg[], ivs: Partial<Record<LegRole, number>>): string[] {
  const options = position.legs.filter((l) => l.kind !== 'stock')
  return legs.flatMap((l, k) => {
    const iv = ivs[l.role]
    if (!l.contract || iv === undefined || options[k]?.iv !== iv) return []
    return [`The $${fmtStrike(l.contract.strike)} ${l.contract.type}'s price is about what it's worth if used today, so the graph and odds use the chain's ${Math.round(iv * 100)}% IV.`]
  })
}

export function buildPosition({ strategy, chain, picks, contracts, fill, shareCost, today }: BuildInput): BuildResult {
  const legs = planLegs(strategy, chain, picks)
  const missing = legs.find((l) => !l.contract)
  if (missing) return { built: null, error: missingMessage(strategy, missing.role, picks) }
  const cs = legs.map((l) => l.contract as OptionContract)
  if (strategy === 'put_credit_spread' && cs[1].strike >= cs[0].strike) {
    return { built: null, error: `Pick a wing strike below the strike you sell ($${fmtStrike(cs[0].strike)}).` }
  }
  const priced = cs.map((c) => pricing(c, chain, today))
  const spread = strategy === 'put_credit_spread'
  const defaultFill = spread ? priced[0].price - priced[1].price : priced[0].price
  const premium: Partial<Record<LegRole, number>> = spread
    ? { short: (fill ?? defaultFill) + priced[1].price, long: priced[1].price }
    : { [legs[0].role]: fill ?? defaultFill }
  const ivOf = ivFor(chain, today)
  const ivFallback = legs.reduce<Partial<Record<LegRole, number>>>((acc, l, k) => {
    const iv = ivOf(cs[k])
    return iv == null ? acc : { ...acc, [l.role]: iv }
  }, {})
  const legInputs = legs.reduce<Partial<Record<LegRole, OptionContract>>>((acc, l, k) => ({ ...acc, [l.role]: cs[k] }), {})
  const inputs: StrategyInputs = {
    spot: chain.underlying, contracts, expiry: chain.expiry, today, premiumOverride: premium, ivFallback, ...legInputs,
    shareCost: strategy === 'covered_call' ? shareCost ?? chain.underlying : undefined
  }
  let position: Position
  try {
    position = buildCalc(strategy, inputs)
  } catch (e) {
    if (e instanceof InputError) return { built: null, error: plainError(e.errors[0], { strategy, legs, premium, spot: chain.underlying }) }
    throw e
  }
  const used = priced.filter((_, k) => fill == null || (spread && k === 1))
  const n = contracts
  const views: LegView[] = legs.map((l, k) => ({ label: legLabel(l.action, n, chain.ticker, cs[k]), contract: cs[k] }))
  return {
    built: {
      position,
      warnings: quoteWarnings(cs, fill),
      notes: [...used.flatMap((p) => (p.note ? [p.note] : [])), ...floorNotes(position, legs, ivFallback)],
      legs: strategy === 'covered_call' ? [{ label: `Own ${n * 100} ${chain.ticker} shares`, contract: null }, ...views] : views,
      defaultFill,
      fillLabel: FILL_LABEL[strategy],
      strikes: cs.map((c) => c.strike)
    },
    error: null
  }
}
