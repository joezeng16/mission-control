import type { KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'
import { STRATEGIES, type Strategy } from '../../lib/position'

interface StrategyPickerProps {
  value: Strategy
  onChange: (s: Strategy) => void
}

/** The four trade types as a 2 × 2 segmented control, each with a one-line plain description. */
export function StrategyPicker({ value, onChange }: StrategyPickerProps): React.JSX.Element {
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (dir === 0) return
    e.preventDefault()
    const i = STRATEGIES.findIndex((s) => s.value === value)
    onChange(STRATEGIES[(i + dir + STRATEGIES.length) % STRATEGIES.length].value)
    const group = e.currentTarget
    requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div role="radiogroup" aria-label="Trade type" onKeyDown={onKey} className="grid grid-cols-2 gap-1.5">
      {STRATEGIES.map((s) => {
        const on = s.value === value
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(s.value)}
            className={cn(
              'ring-focus relative flex min-h-[58px] flex-col items-start justify-center gap-1 rounded-xl border px-3 py-2 text-left transition-[background,border-color,box-shadow] duration-150',
              on
                ? 'border-profit/55 bg-gradient-to-b from-profit/[0.14] to-profit/[0.04] shadow-[0_0_24px_-10px_rgb(0_200_5/0.8),inset_0_1px_0_rgb(255_255_255/0.08)]'
                : 'border-line bg-white/[0.02] hover:border-line-2 hover:bg-white/[0.04]'
            )}
          >
            <span className={cn('text-[12.5px] font-semibold leading-tight', on ? 'text-fg' : 'text-fg-2')}>{s.label}</span>
            <span className="text-[11px] leading-tight text-fg-3">{s.blurb}</span>
            {on && <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-profit shadow-[0_0_8px_rgb(0_200_5)]" />}
          </button>
        )
      })}
    </div>
  )
}
