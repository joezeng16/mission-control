import { CircleAlert, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PLChart } from '../charts/PLChart'
import { PLLegend } from '../charts/PLReadout'
import { CalcSliders } from '../components/calc/CalcSliders'
import { PLHero } from '../components/calc/PLHero'
import { SetupPanel } from '../components/calc/SetupPanel'
import { StatsGrid } from '../components/calc/StatsGrid'
import { Segmented } from '../components/Segmented'
import type { CalcRequest } from '../lib/calcRequest'
import { addDays, fmtDate } from '../lib/format'
import { valueAt } from '../lib/interp'
import { offHoursIv } from '../lib/position'
import { useCalculator, type Calculator } from '../lib/useCalculator'
import { chainIsLive, plAt, plAtExpiry } from '@shared/calc'

const RANGES = [
  { value: '0.2', label: '±20%' },
  { value: '0.4', label: '±40%' },
  { value: '0.6', label: '±60%' }
] as const

function ChartState({ c }: { c: Calculator }): React.JSX.Element {
  if (c.phase === 'error') {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <CircleAlert size={20} className="text-loss" />
          <p className="text-[13px] text-fg-2">{c.error}</p>
          <button type="button" onClick={c.retry} className="ring-focus btn-ghost inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[12.5px]">
            <RotateCw size={13} /> Try again
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col justify-end gap-3 pb-8 pl-16 pr-4">
      <div className="skeleton h-full w-full opacity-60" />
      <p className="text-center text-[12.5px] text-fg-3">Loading {c.ticker}'s option chain…</p>
    </div>
  )
}

function baseIv(c: Calculator): number | null {
  const leg = c.built?.position.legs.find((l) => l.kind !== 'stock' && l.side === -1) ?? c.built?.position.legs.find((l) => l.kind !== 'stock')
  return leg?.iv ?? null
}

/** Plain-words notes above the graph: off-hours chain, then stale quotes / IV swaps / legs without a live quote. */
function bannerLines(c: Calculator): string[] {
  const notes = c.built?.notes ?? []
  if (!c.chain) return []
  if (!chainIsLive(c.chain)) {
    const off = offHoursIv(c.chain, c.today)
    const iv = off ? `${Math.round(off.iv * 100)}% IV ${off.fromTrades ? 'backed out of the last trades' : 'estimate (no usable last trades)'}` : 'an IV estimate'
    return [
      `Option quotes aren't live right now (before the open, after hours, or Yahoo is slow). Strikes are placed with a ${iv}, and prices are last trades or estimates. Check your broker before you trade.`,
      ...notes
    ]
  }
  return [...(c.built?.warnings ?? []), ...notes]
}

/** P/L at the cursor (or today's price) on each curve. */
function heroValues(c: Calculator, hoverX: number | null): { x: number; atExpiry: number; atDate: number; today: number } {
  const d = c.derived
  const pos = c.built?.position
  const x = hoverX ?? c.spot
  if (!pos || !d) return { x, atExpiry: 0, atDate: 0, today: 0 }
  return {
    x,
    atExpiry: hoverX != null ? valueAt(d.points, x, (p) => p.expiry) ?? 0 : plAtExpiry(pos, x),
    atDate: valueAt(d.points, x, (p) => p.at) ?? plAt(pos, x, c.totalDays - c.dateDays, c.ivShift, c.today),
    today: valueAt(d.points, x, (p) => p.today) ?? 0
  }
}

interface CalculatorTabProps {
  request: CalcRequest | null
}

export function CalculatorTab({ request }: CalculatorTabProps): React.JSX.Element {
  const c = useCalculator()
  const [hoverX, setHoverX] = useState<number | null>(null)
  const loadRef = useRef(c)
  loadRef.current = c

  useEffect(() => {
    if (request) void loadRef.current.loadRequest(request)
    else void loadRef.current.loadTicker('NVDA')
  }, [request])

  const d = c.derived
  const expiry = c.chain?.expiry ?? null
  const expiryLabel = expiry ? fmtDate(expiry, Number(c.today.slice(0, 4))) : 'expiry'
  const dateLabel = c.dateDays > 0 && c.dateDays < c.totalDays ? fmtDate(addDays(c.today, c.dateDays)) : null
  const hero = heroValues(c, hoverX)
  const ready = c.phase === 'ready' && d != null && c.built != null
  const lines = bannerLines(c)
  const tpLine = d?.takeProfit && (c.strategy === 'csp' || c.strategy === 'put_credit_spread') ? d.takeProfit.profit : null

  return (
    <div className="flex h-full min-h-0 gap-3">
      <aside className="glass w-[340px] shrink-0 overflow-y-auto p-4">
        <SetupPanel c={c} />
      </aside>
      <section className="glass @container flex min-w-0 flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-4">
          <PLHero
            ticker={c.ticker}
            stockPrice={hero.x}
            hovering={hoverX != null}
            expiryLabel={expiryLabel}
            dateLabel={dateLabel}
            atExpiry={hero.atExpiry}
            atDate={hero.atDate}
            today={hero.today}
            cash={d?.stats.cash ?? 0}
            ready={ready}
          />
          <div className="flex shrink-0 flex-col items-end gap-3">
            <Segmented label="Price range" size="sm" value={String(c.range)} onChange={(v) => c.setRange(Number(v))} options={RANGES} />
            <PLLegend expiryLabel={`At expiry, ${expiryLabel}`} dateLabel={dateLabel} ivShifted={c.ivShift !== 0} takeProfit={tpLine != null} />
          </div>
        </div>
        {lines.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-3 py-2 text-[12.5px] text-amber-200">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <div>{lines.map((w) => <p key={w}>{w}</p>)}</div>
          </div>
        )}
        <div className="relative -mx-1 min-h-[220px] flex-1">
          {ready && d ? (
            <PLChart
              points={d.points}
              basePoints={d.basePoints}
              spot={c.spot}
              breakevens={d.stats.breakevens}
              strikes={c.built?.strikes ?? []}
              hoverX={hoverX}
              onHover={setHoverX}
              dateLabel={dateLabel}
              expiryLabel="At expiry"
              cash={d.stats.cash}
              takeProfit={tpLine}
              revealKey={`${c.ticker}-${c.strategy}-${expiry}`}
            />
          ) : c.phase === 'ready' && !c.built ? (
            <div className="grid h-full place-items-center px-6 text-center text-[13px] text-fg-3">
              {c.buildError ?? 'Pick the strikes on the left to draw the graph.'}
            </div>
          ) : (
            <ChartState c={c} />
          )}
        </div>
        <div className="glass-inset px-4 pb-2 pt-3">
          <CalcSliders
            today={c.today}
            totalDays={c.totalDays}
            dateDays={c.dateDays}
            onDateDays={c.setDateDays}
            ivShift={c.ivShift}
            onIvShift={c.setIvShift}
            baseIv={baseIv(c)}
          />
        </div>
        {ready && d && c.built && expiry ? (
          <StatsGrid
            stats={d.stats}
            strategy={c.strategy}
            built={c.built}
            ticker={c.ticker}
            spot={c.spot}
            expiry={expiry}
            takeProfit={d.takeProfit}
            tested={c.ctx.tested}
            level={c.ctx.level}
          />
        ) : (
          <div className="grid grid-cols-4 gap-2" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="glass-inset h-[78px] p-3">
                <div className="skeleton h-2.5 w-2/3" />
                <div className="skeleton mt-3 h-4 w-1/2" />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
