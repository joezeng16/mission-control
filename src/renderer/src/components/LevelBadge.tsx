import type { Level } from '@shared/types'
import { cn } from '../lib/cn'

/** 3/3 is solid, 2/3 tinted, 1/3 outlined, so the level reads even without color. */
const STYLE: Record<Level, string> = {
  3: 'bg-lv3 text-[#02240f] border-lv3 shadow-[0_0_14px_rgb(0_230_118/0.45)]',
  2: 'bg-lv2/20 text-lv2 border-lv2/70',
  1: 'bg-transparent text-lv1 border-lv1/45'
}

interface LevelBadgeProps {
  level: Level
  size?: 'sm' | 'md'
  className?: string
}

export function LevelBadge({ level, size = 'md', className }: LevelBadgeProps): React.JSX.Element {
  return (
    <span
      aria-label={`Level ${level} of 3`}
      className={cn(
        'num inline-flex shrink-0 items-center justify-center rounded-md border font-semibold',
        size === 'md' ? 'h-[22px] w-[34px] text-[11.5px]' : 'h-[18px] w-[28px] text-[10.5px]',
        STYLE[level],
        className
      )}
    >
      {level}/3
    </span>
  )
}
