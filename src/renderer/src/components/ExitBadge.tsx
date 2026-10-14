import type { ExitTag } from '@shared/types'
import { cn } from '../lib/cn'

/** Exit tag colors. 'TP' (a one-step take profit) shares TP 1's red. */
export const EXIT_COLOR: Record<ExitTag, string> = {
  TP: '#ff1744',
  'TP 1': '#ff1744',
  'TP 2': '#b71c1c',
  'STOP LOSS': '#9e9e9e',
  TIME: '#ff9800'
}

interface ExitBadgeProps {
  tag: ExitTag
  className?: string
}

export function ExitBadge({ tag, className }: ExitBadgeProps): React.JSX.Element {
  const color = EXIT_COLOR[tag]
  return (
    <span
      className={cn('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold text-fg', className)}
      style={{
        background: `color-mix(in srgb, ${color} 17%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 55%, transparent)`
      }}
    >
      <span className="size-[7px] rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      {tag}
    </span>
  )
}

/** Legend for the common exit tags (two-step TP 1 / TP 2 rows still get their own colors in the list). */
export function ExitLegend(): React.JSX.Element {
  const items: ExitTag[] = ['TP', 'STOP LOSS', 'TIME']
  return (
    <div className="flex items-center gap-3 text-[11px] text-fg-3">
      {items.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="size-[7px] rounded-full" style={{ background: EXIT_COLOR[t] }} />
          {t}
        </span>
      ))}
    </div>
  )
}
