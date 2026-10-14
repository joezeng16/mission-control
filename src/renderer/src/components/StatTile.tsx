import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

interface StatTileProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'profit' | 'loss' | 'warn' | 'neutral'
  meter?: number | null
  className?: string
}

const TONE = { profit: 'text-profit', loss: 'text-loss', warn: 'text-warn', neutral: 'text-fg' } as const

/** One number with a plain label above and a short explanation below. Optional 0..1 meter. */
export function StatTile({ label, value, sub, tone = 'neutral', meter, className }: StatTileProps): React.JSX.Element {
  return (
    <div className={cn('glass-inset flex min-w-0 flex-col gap-1 px-3 py-2.5', className)}>
      <div className="truncate text-[11.5px] text-fg-3">{label}</div>
      <div className={cn('num truncate text-[17px] font-semibold leading-none tracking-tight', TONE[tone])}>{value}</div>
      {meter != null && (
        <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-profit shadow-[0_0_8px_rgb(0_200_5/0.7)] transition-[width] duration-500"
            style={{ width: `${Math.max(0, Math.min(1, meter)) * 100}%` }}
          />
        </div>
      )}
      {sub != null && <div className="truncate text-[11px] text-fg-3">{sub}</div>}
    </div>
  )
}
