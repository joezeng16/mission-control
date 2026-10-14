import { motion } from 'motion/react'
import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  size?: 'sm' | 'md'
  className?: string
}

/** A pill switcher with a sliding highlight. Arrow keys move between options. */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', className }: SegmentedProps<T>): React.JSX.Element {
  const id = useId()
  const move = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
    onChange(next.value)
    const group = e.currentTarget
    requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={move}
      className={cn('relative inline-flex items-center rounded-[10px] border border-line bg-black/30 p-[3px]', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'ring-focus relative z-0 flex-1 whitespace-nowrap rounded-[7px] font-medium transition-colors duration-150',
              size === 'md' ? 'h-7 px-3 text-[12.5px]' : 'h-6 px-2.5 text-[11.5px]',
              active ? 'text-fg' : 'text-fg-3 hover:text-fg-2'
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                className="absolute inset-0 -z-10 rounded-[7px] border border-white/10 bg-white/[0.09] shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
              />
            )}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
