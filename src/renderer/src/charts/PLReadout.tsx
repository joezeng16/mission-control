import { cn } from '../lib/cn'
import { isLoss, money, pct, price } from '../lib/format'
import { PL_COLORS } from './plGeometry'

export interface ReadoutRow {
  label: string
  color: string
  value: number
}

interface PLReadoutProps {
  left: number
  top: number
  flip: boolean
  stockPrice: number
  spot: number
  rows: ReadoutRow[]
  cash?: number
}

/** The floating box next to the crosshair: the stock price and P/L on each curve. */
export function PLReadout({ left, top, flip, stockPrice, spot, rows, cash }: PLReadoutProps): React.JSX.Element {
  const change = spot > 0 ? stockPrice / spot - 1 : 0
  const expiry = rows[0]?.value ?? 0
  return (
    <div
      className={cn(
        'pointer-events-none absolute z-10 w-[188px] rounded-xl border border-line-2 bg-[#0c0e15]/90 p-2.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.9)] backdrop-blur-md',
        flip && '-translate-x-full'
      )}
      style={{ left, top }}
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
        <span className="num text-[13px] font-semibold text-fg">{price(stockPrice)}</span>
        <span className={cn('num text-[11px]', change >= 0 ? 'text-profit' : 'text-loss')}>{pct(change, 1, true)}</span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-[11.5px]">
            <span className="h-[3px] w-3 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="flex-1 truncate text-fg-2">{r.label}</span>
            <span className={cn('num font-medium', isLoss(r.value) ? 'text-loss' : 'text-profit')}>{money(r.value, { sign: true })}</span>
          </div>
        ))}
      </div>
      {cash != null && cash > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-fg-3">
          At expiry that is <span className={cn('num', Math.round((expiry / cash) * 1000) < 0 ? 'text-loss' : 'text-profit')}>{pct(expiry / cash, 1, true)}</span> of the cash
        </div>
      )}
    </div>
  )
}

interface PLLegendProps {
  expiryLabel: string
  dateLabel: string | null
  ivShifted: boolean
  takeProfit?: boolean
}

/** Names the curves, so color is never the only cue. */
export function PLLegend({ expiryLabel, dateLabel, ivShifted, takeProfit = false }: PLLegendProps): React.JSX.Element {
  const item = (color: string, label: string, dashed = false): React.JSX.Element => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="6" aria-hidden="true">
        <line x1="1" x2="15" y1="3" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? '3 3' : undefined} />
      </svg>
      {label}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-3">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-[3px] w-4 rounded-full bg-gradient-to-r from-profit to-loss" />
        {expiryLabel}
      </span>
      {dateLabel && item(PL_COLORS.date, dateLabel)}
      {item(PL_COLORS.today, 'Today')}
      {takeProfit && item(PL_COLORS.profit, '50% buy-back', true)}
      {ivShifted && item('#8b93a7', 'Normal price swings', true)}
    </div>
  )
}
