import { motion, useReducedMotion } from 'motion/react'
import { memo, useId, useMemo, type KeyboardEvent, type PointerEvent } from 'react'
import { compactMoney, isLoss, money, price, strike as fmtStrike } from '../lib/format'
import { valueAt } from '../lib/interp'
import { useElementSize } from '../lib/useElementSize'
import { breakevenTag, buildGeometry, MARGIN, PL_COLORS, readoutTop, type Geometry, type PLPoint } from './plGeometry'
import { PLReadout, type ReadoutRow } from './PLReadout'

export type { PLPoint } from './plGeometry'

export interface PLChartProps {
  /** Curves from the math module: { x, expiry, at, today } per stock price. */
  points: PLPoint[]
  /** The same curves before the IV what-if (drawn dashed) or null when the IV slider is at 0. */
  basePoints?: PLPoint[] | null
  spot: number
  breakevens: number[]
  strikes: number[]
  hoverX: number | null
  onHover: (x: number | null) => void
  /** e.g. 'Oct 30'; the date curve is hidden when null. */
  dateLabel?: string | null
  expiryLabel?: string
  cash?: number
  /** P/L if the 50% take-profit buy-back fills (drawn as a dashed line); null = not shown. */
  takeProfit?: number | null
  /** Changing this replays the left-to-right reveal (new ticker or entry). */
  revealKey?: string
}

const GRID = 'rgb(255 255 255 / 0.05)'
/** One font for every label on the chart (axes and tags), with even-width digits. */
const FONT = { fontFamily: "'Geist Variable', ui-sans-serif, system-ui, sans-serif", style: { fontVariantNumeric: 'tabular-nums' } } as const
const AXIS_TEXT = { fill: '#6a7285', fontSize: 11, ...FONT } as const
const HALO = { paintOrder: 'stroke', stroke: '#05060a', strokeWidth: 4, strokeLinejoin: 'round' } as const
const TAG_H = 18

function Axes({ g, width }: { g: Geometry; width: number }): React.JSX.Element {
  return (
    <g aria-hidden="true">
      {g.yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={MARGIN.left} x2={g.plotRight} y1={g.y(t)} y2={g.y(t)} stroke={GRID} />
          <text x={MARGIN.left - 10} y={g.y(t)} dy="0.32em" textAnchor="end" {...AXIS_TEXT}>
            {t === 0 ? '$0' : compactMoney(t, true)}
          </text>
        </g>
      ))}
      {g.xTicks.map((t) => (
        <text key={`x${t}`} x={g.x(t)} y={g.plotBottom + 19} textAnchor="middle" {...AXIS_TEXT}>
          ${t >= 1000 ? `${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}K` : fmtStrike(t)}
        </text>
      ))}
      <line x1={MARGIN.left} x2={width - MARGIN.right} y1={g.plotBottom} y2={g.plotBottom} stroke="rgb(255 255 255 / 0.08)" />
    </g>
  )
}

interface MarkersProps { g: Geometry; spot: number; breakevens: number[]; strikes: number[]; points: PLPoint[]; showDate: boolean; guides: number[] }

function BreakevenTag({ g, b, points, showDate, guides }: { g: Geometry; b: number; points: PLPoint[]; showDate: boolean; guides: number[] }): React.JSX.Element {
  const label = `Breakeven ${price(b)}`
  const w = label.length * 6.4 + 14
  const box = breakevenTag(g, points, g.x(b), w, TAG_H, showDate, sample, guides)
  return (
    <g>
      <circle cx={g.x(b)} cy={g.zero} r={4.5} fill="#05060a" stroke="#eceff5" strokeWidth={1.75} />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} fill="#0c0e15" fillOpacity={0.92} stroke="rgb(255 255 255 / 0.14)" />
      <text x={box.x + box.w / 2} y={box.y + box.h / 2} dy="0.34em" textAnchor="middle" fontSize={11} fill="#c9cfdb" {...FONT}>
        {label}
      </text>
    </g>
  )
}

function Markers({ g, spot, breakevens, strikes, points, showDate, guides }: MarkersProps): React.JSX.Element {
  const [lo, hi] = g.x.domain()
  const inside = (v: number): boolean => v >= lo && v <= hi
  const sx = g.x(spot)
  const spotLabel = `Now ${price(spot)}`
  const spotW = spotLabel.length * 6.6 + 16
  return (
    <g aria-hidden="true">
      {strikes.filter(inside).map((k) => (
        <g key={`k${k}`}>
          <line x1={g.x(k)} x2={g.x(k)} y1={MARGIN.top} y2={g.plotBottom} stroke="rgb(255 255 255 / 0.13)" strokeDasharray="1 4" strokeLinecap="round" />
          <path d={`M${g.x(k)},${g.plotBottom - 5} l4,5 l-4,5 l-4,-5 z`} fill="#a4acbd" />
          <text x={g.x(k)} y={g.plotBottom - 10} textAnchor="middle" fontSize={10.5} fill="#a4acbd" {...FONT} {...HALO}>
            ${fmtStrike(k)}
          </text>
        </g>
      ))}
      {inside(spot) && (
        <g>
          <line x1={sx} x2={sx} y1={MARGIN.top - 4} y2={g.plotBottom} stroke="rgb(255 255 255 / 0.4)" strokeDasharray="3 4" />
          <rect x={sx - spotW / 2} y={MARGIN.top - 26} width={spotW} height={20} rx={10} fill="#141824" stroke="rgb(255 255 255 / 0.16)" />
          <text x={sx} y={MARGIN.top - 12.5} textAnchor="middle" fontSize={11} fontWeight={600} fill="#eceff5" {...FONT}>
            {spotLabel}
          </text>
        </g>
      )}
      {breakevens.filter(inside).map((b) => <BreakevenTag key={`b${b}`} g={g} b={b} points={points} showDate={showDate} guides={guides} />)}
    </g>
  )
}

function TakeProfitLine({ g, value }: { g: Geometry; value: number }): React.JSX.Element | null {
  const y = g.y(value)
  if (y < MARGIN.top || y > g.plotBottom) return null
  return (
    <g aria-hidden="true" pointerEvents="none">
      <line x1={MARGIN.left} x2={g.plotRight} y1={y} y2={y} stroke={PL_COLORS.profit} strokeOpacity={0.6} strokeWidth={1.25} strokeDasharray="6 5" />
      <text x={MARGIN.left + 8} y={y - 6} fontSize={11} fill={PL_COLORS.profit} {...FONT} {...HALO}>
        50% buy-back {money(value, { sign: true })}
      </text>
    </g>
  )
}

function PLChartImpl(props: PLChartProps): React.JSX.Element {
  const { points, basePoints = null, spot, breakevens, strikes, hoverX, onHover, dateLabel = null, expiryLabel = 'At expiry', cash, takeProfit = null, revealKey } = props
  const [box, size] = useElementSize<HTMLDivElement>()
  const reduce = useReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const showDate = dateLabel != null
  const g = useMemo(() => buildGeometry(points, basePoints, size.width, size.height, showDate), [points, basePoints, size.width, size.height, showDate])

  const move = (e: PointerEvent<SVGSVGElement>): void => {
    if (!g) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = Math.min(Math.max(e.clientX - r.left, MARGIN.left), g.plotRight)
    onHover(g.x.invert(px))
  }
  const key = (e: KeyboardEvent<SVGSVGElement>): void => {
    if (!g) return
    const [lo, hi] = g.x.domain()
    const step = (hi - lo) / (e.shiftKey ? 24 : 120)
    const cur = hoverX ?? spot
    const next = e.key === 'ArrowRight' ? cur + step : e.key === 'ArrowLeft' ? cur - step : e.key === 'Home' ? lo : e.key === 'End' ? hi : null
    if (e.key === 'Escape') onHover(null)
    if (next == null) return
    e.preventDefault()
    onHover(Math.min(Math.max(next, lo), hi))
  }

  const hx = g && hoverX != null ? g.x(hoverX) : null
  const rows: ReadoutRow[] = hoverX == null ? [] : [
    { label: expiryLabel, color: isLoss(valueAt(points, hoverX, (p) => p.expiry) ?? 0) ? PL_COLORS.loss : PL_COLORS.profit, value: valueAt(points, hoverX, (p) => p.expiry) ?? 0 },
    ...(showDate ? [{ label: dateLabel as string, color: PL_COLORS.date, value: valueAt(points, hoverX, (p) => p.at) ?? 0 }] : []),
    { label: 'Today', color: PL_COLORS.today, value: valueAt(points, hoverX, (p) => p.today) ?? 0 }
  ]
  const id = (n: string): string => `${n}${uid}`

  return (
    <div ref={box} className="relative h-full w-full">
      {g && (
        <svg
          width={size.width}
          height={size.height}
          className="ring-focus block cursor-crosshair touch-none rounded-lg"
          role="img"
          aria-label="Profit and loss by stock price. Use the arrow keys to move along it."
          tabIndex={0}
          onPointerMove={move}
          onPointerDown={move}
          onPointerLeave={() => onHover(null)}
          onKeyDown={key}
          onFocus={() => hoverX == null && onHover(spot)}
          onBlur={() => onHover(null)}
        >
          <defs>
            <linearGradient id={id('gp')} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={g.peak} y2={g.zero}>
              <stop offset="0" stopColor={PL_COLORS.profit} stopOpacity="0.5" />
              <stop offset="1" stopColor={PL_COLORS.profit} stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id={id('gl')} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={g.zero} y2={g.trough}>
              <stop offset="0" stopColor={PL_COLORS.loss} stopOpacity="0.04" />
              <stop offset="1" stopColor={PL_COLORS.loss} stopOpacity="0.42" />
            </linearGradient>
            <clipPath id={id('ca')}><rect x="0" y="0" width={size.width} height={Math.max(g.zero, 0)} /></clipPath>
            <clipPath id={id('cb')}><rect x="0" y={g.zero} width={size.width} height={Math.max(size.height - g.zero, 0)} /></clipPath>
            <clipPath id={id('rv')}>
              <motion.rect
                key={revealKey}
                x={MARGIN.left - 4}
                y="0"
                height={size.height}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: g.plotRight - MARGIN.left + 8 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              />
            </clipPath>
            <filter id={id('glow')} x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          <Axes g={g} width={size.width} />
          <g clipPath={`url(#${id('rv')})`}>
            <path d={g.area} fill={`url(#${id('gp')})`} clipPath={`url(#${id('ca')})`} />
            <path d={g.area} fill={`url(#${id('gl')})`} clipPath={`url(#${id('cb')})`} />
            <line x1={MARGIN.left} x2={g.plotRight} y1={g.zero} y2={g.zero} stroke="rgb(255 255 255 / 0.32)" />
            {g.baseToday && <path d={g.baseToday} fill="none" stroke={PL_COLORS.today} strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 4" />}
            {g.baseAt && <path d={g.baseAt} fill="none" stroke={PL_COLORS.date} strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 4" />}
            <path d={g.today} fill="none" stroke={PL_COLORS.today} strokeWidth="1.75" strokeLinecap="round" />
            {g.at && <path d={g.at} fill="none" stroke={PL_COLORS.date} strokeWidth="1.75" strokeLinecap="round" />}
            <g clipPath={`url(#${id('ca')})`}>
              <path d={g.expiry} fill="none" stroke={PL_COLORS.profit} strokeWidth="6" strokeOpacity="0.35" filter={`url(#${id('glow')})`} />
              <path d={g.expiry} fill="none" stroke={PL_COLORS.profit} strokeWidth="2.5" strokeLinecap="round" />
            </g>
            <g clipPath={`url(#${id('cb')})`}>
              <path d={g.expiry} fill="none" stroke={PL_COLORS.loss} strokeWidth="6" strokeOpacity="0.3" filter={`url(#${id('glow')})`} />
              <path d={g.expiry} fill="none" stroke={PL_COLORS.loss} strokeWidth="2.5" strokeLinecap="round" />
            </g>
          </g>
          {takeProfit != null && <TakeProfitLine g={g} value={takeProfit} />}
          <Markers g={g} spot={spot} breakevens={breakevens} strikes={strikes} points={points} showDate={showDate} guides={takeProfit != null ? [g.y(takeProfit)] : []} />
          {hx != null && hoverX != null && <Crosshair g={g} hx={hx} hoverX={hoverX} points={points} showDate={showDate} />}
        </svg>
      )}
      {g && hx != null && hoverX != null && (
        <PLReadout
          left={hx > size.width - 230 ? hx - 14 : hx + 14}
          top={readoutTop(g, points, hx > size.width - 230 ? hx - 202 : hx + 14, hx > size.width - 230 ? hx - 14 : hx + 202, sample)}
          flip={hx > size.width - 230}
          stockPrice={hoverX}
          spot={spot}
          rows={rows}
          cash={cash}
        />
      )}
    </div>
  )
}

function sample(points: readonly PLPoint[], x: number, k: keyof PLPoint): number {
  return valueAt(points, x, (p) => p[k]) ?? 0
}

function Crosshair({ g, hx, hoverX, points, showDate }: { g: Geometry; hx: number; hoverX: number; points: PLPoint[]; showDate: boolean }): React.JSX.Element {
  const ye = valueAt(points, hoverX, (p) => p.expiry) ?? 0
  const yt = valueAt(points, hoverX, (p) => p.today) ?? 0
  const ya = valueAt(points, hoverX, (p) => p.at) ?? 0
  const label = price(hoverX)
  const w = label.length * 6.8 + 14
  return (
    <g pointerEvents="none">
      <line x1={hx} x2={hx} y1={MARGIN.top - 4} y2={g.plotBottom} stroke="rgb(255 255 255 / 0.55)" />
      <circle cx={hx} cy={g.y(yt)} r={4} fill={PL_COLORS.today} stroke="#05060a" strokeWidth={2} />
      {showDate && <circle cx={hx} cy={g.y(ya)} r={4} fill={PL_COLORS.date} stroke="#05060a" strokeWidth={2} />}
      <circle cx={hx} cy={g.y(ye)} r={9} fill={ye >= 0 ? PL_COLORS.profit : PL_COLORS.loss} opacity={0.22} />
      <circle cx={hx} cy={g.y(ye)} r={5} fill={ye >= 0 ? PL_COLORS.profit : PL_COLORS.loss} stroke="#05060a" strokeWidth={2} />
      <rect x={hx - w / 2} y={g.plotBottom + 5} width={w} height={20} rx={6} fill="#eceff5" />
      <text x={hx} y={g.plotBottom + 19} textAnchor="middle" fontSize={11} fontWeight={600} fill="#05060a" {...FONT}>
        {label}
      </text>
    </g>
  )
}

export const PLChart = memo(PLChartImpl)
