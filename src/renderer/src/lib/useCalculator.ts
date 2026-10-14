/** Calculator state: what you picked, what Yahoo returned, and the curves / stats derived from them. */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Chain, Quote } from '@shared/types'
import { curve, nearestExpiry, stats, type CurvePoint, type Stats } from '@shared/calc'
import { api } from './api'
import type { CalcRequest } from './calcRequest'
import { daysBetween, localToday } from './format'
import {
  buildPosition, contextFor, defaultPicks, keepPicks, NO_PICKS, switchPicks, takeProfitOf, TYPED,
  type BuildResult, type Built, type PickContext, type Picks, type Strategy, type TakeProfit
} from './position'

export type Phase = 'idle' | 'loading' | 'ready' | 'error'

const LEAPS_DAYS = 365
const NORMAL_DAYS = 40
const LEAPS_SWITCH_DAYS = 180
const N_POINTS = 181

/** Long call: about a year out. Put trades: the signal's own expiry when it was live, else the one nearest 40 days. */
function wantedExpiry(exps: string[], strategy: Strategy, today: string, ctx: PickContext): string | null {
  if (strategy === 'long_call') return nearestExpiry(exps, today, LEAPS_DAYS)
  const a = ctx.anchor
  if (a && exps.includes(a.expiry) && daysBetween(today, a.expiry) >= 1) return a.expiry
  return nearestExpiry(exps, today, NORMAL_DAYS)
}

export interface Derived {
  points: CurvePoint[]
  basePoints: CurvePoint[] | null
  stats: Stats
  takeProfit: TakeProfit | null
}

export function useCalculator() {
  const today = localToday()
  const [ticker, setTicker] = useState('NVDA')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [expirations, setExpirations] = useState<string[]>([])
  const [chain, setChain] = useState<Chain | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [strategy, setStrategyState] = useState<Strategy>('put_credit_spread')   // the signals table hands over put credit spreads
  const [ctx, setCtx] = useState<PickContext>(TYPED)
  const [picks, setPicksState] = useState<Picks>(NO_PICKS)
  const [contracts, setContracts] = useState(1)
  const [fill, setFill] = useState<number | null>(null)
  const [shareCost, setShareCost] = useState<number | null>(null)
  const [dateDays, setDateDays] = useState(0)
  const [ivShift, setIvShift] = useState(0)
  const [range, setRange] = useState(0.4)
  const req = useRef(0)

  const fail = useCallback((t: string): void => {
    setChain(null)                       // never mix the new ticker's quote with the old ticker's chain
    setPicksState(NO_PICKS)
    setPhase('error')
    setError(`Couldn't load the chain for ${t}. Try again.`)
  }, [])

  const loadChain = useCallback(
    async (t: string, expiry: string, strat: Strategy, nextPicks: (c: Chain) => Picks): Promise<void> => {
      const id = ++req.current
      setPhase('loading')
      setError(null)
      try {
        const c = await api.market.chain(t, expiry)
        if (id !== req.current) return
        setChain(c)
        setPicksState(nextPicks(c))
        setFill(null)
        setDateDays(0)
        setStrategyState(strat)
        setPhase('ready')
      } catch {
        if (id === req.current) fail(t)
      }
    },
    [fail]
  )

  const load = useCallback(
    async (raw: string, strat: Strategy, next: PickContext): Promise<void> => {
      const t = raw.trim().toUpperCase()
      const id = ++req.current
      setTicker(t)
      setCtx(next)
      setPhase('loading')
      setError(null)
      setShareCost(null)
      try {
        const [q, exps] = await Promise.all([api.market.quote(t), api.market.expirations(t)])
        if (id !== req.current) return
        const anchor = next.anchor?.expiry
        const all = anchor && !exps.includes(anchor) ? [...exps, anchor].sort() : exps
        const list = all.filter((e) => daysBetween(today, e) >= 1)     // only expirations at least 1 day out
        setQuote(q)
        setExpirations(list)
        const expiry = wantedExpiry(list, strat, today, next)
        if (!expiry) throw new Error('no expirations')
        await loadChain(t, expiry, strat, (c) => defaultPicks(strat, c, today, next))
      } catch {
        if (id === req.current) fail(t)
      }
    },
    [today, loadChain, fail]
  )

  /** A ticker typed by hand: no signal, so the sold put is the TYPED_PUT_DELTA one. */
  const loadTicker = useCallback((raw: string): Promise<void> => load(raw, strategy, TYPED), [load, strategy])
  /** A scanner row's Calculate button: a put credit spread selling the signal's strike (live) or its level's delta, and
   *  buying the scanner's wing (live) or the 0.10 delta put. */
  const loadRequest = useCallback((r: CalcRequest): Promise<void> => load(r.ticker, 'put_credit_spread', contextFor(r)), [load])
  const retry = (): void => void load(ticker, strategy, ctx)

  const setStrategy = (s: Strategy): void => {
    if (!chain) {
      setStrategyState(s)
      return
    }
    const days = daysBetween(today, chain.expiry)
    const needsLong = s === 'long_call' && days < LEAPS_SWITCH_DAYS
    const needsShort = s !== 'long_call' && strategy === 'long_call' && days > LEAPS_SWITCH_DAYS
    const target = needsLong || needsShort ? wantedExpiry(expirations, s, today, ctx) : null
    if (target && target !== chain.expiry) {
      void loadChain(ticker, target, s, (c) => defaultPicks(s, c, today, ctx))
      return
    }
    setStrategyState(s)
    setPicksState(switchPicks(picks, s, chain, today, ctx))
    setFill(null)
  }

  const setExpiry = (e: string): void => {
    void loadChain(ticker, e, strategy, (c) => keepPicks(picks, strategy, c, today, ctx))
  }

  const setPick = (which: keyof Picks, k: number): void => {
    setPicksState((p) => ({ ...p, [which]: k }))
    setFill(null)
  }

  const result: BuildResult | null = useMemo(
    () => (chain ? buildPosition({ strategy, chain, picks, contracts, fill, shareCost, today }) : null),
    [chain, strategy, picks, contracts, fill, shareCost, today]
  )
  const built: Built | null = result?.built ?? null

  // the price the position was built on (its IVs are solved there), so the chart, breakevens and stats line up
  const spot = chain?.underlying ?? quote?.price ?? 0
  const totalDays = chain ? Math.max(daysBetween(today, chain.expiry), 0) : 0
  const shownDateDays = Math.min(Math.max(dateDays, 0), totalDays)    // opens on today

  const derived: Derived | null = useMemo(() => {
    if (!built || spot <= 0) return null
    const lo = spot * (1 - range)
    const hi = spot * (1 + range)
    const daysLeft = totalDays - shownDateDays
    const points = curve(built.position, lo, hi, N_POINTS, daysLeft, ivShift, today)
    const basePoints = ivShift !== 0 ? curve(built.position, lo, hi, N_POINTS, daysLeft, 0, today) : null
    return { points, basePoints, stats: stats(built.position, spot, today), takeProfit: takeProfitOf(strategy, built.position) }
  }, [built, spot, range, totalDays, shownDateDays, ivShift, today, strategy])

  return {
    today, ticker, quote, expirations, chain, phase, error, strategy, ctx, picks, contracts, fill, shareCost,
    ivShift, range, totalDays, dateDays: shownDateDays, built, buildError: result?.error ?? null, derived, spot,
    loadTicker, loadRequest, retry, setStrategy, setExpiry, setPick, setContracts, setFill, setShareCost, setDateDays, setIvShift, setRange
  }
}

export type Calculator = ReturnType<typeof useCalculator>
