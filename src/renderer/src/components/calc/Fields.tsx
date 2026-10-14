import { Minus, Plus } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function FieldLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[11.5px] font-medium text-fg-3">{children}</span>
      {aside}
    </div>
  )
}

interface StepperProps {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  label: string
}

export function Stepper({ value, onChange, min = 1, max = 100, label }: StepperProps): React.JSX.Element {
  const set = (n: number): void => onChange(Math.min(max, Math.max(min, Math.round(n) || min)))
  const btn = 'ring-focus grid h-full w-8 place-items-center text-fg-3 transition-colors hover:bg-white/[0.06] hover:text-fg disabled:opacity-30'
  return (
    <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-line bg-black/30">
      <button type="button" aria-label={`Fewer ${label}`} className={btn} disabled={value <= min} onClick={() => set(value - 1)}>
        <Minus size={13} />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(e) => set(Number(e.target.value.replace(/\D/g, '')))}
        className="ring-focus num w-full min-w-0 bg-transparent text-center text-[13px] font-medium text-fg"
      />
      <button type="button" aria-label={`More ${label}`} className={btn} disabled={value >= max} onClick={() => set(value + 1)}>
        <Plus size={13} />
      </button>
    </div>
  )
}

interface MoneyFieldProps {
  value: number
  onCommit: (n: number) => void
  label: string
  suffix?: string
}

/** A $ price box that commits on Enter or when it loses focus. */
export function MoneyField({ value, onCommit, label, suffix }: MoneyFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(value.toFixed(2))
  useEffect(() => setDraft(value.toFixed(2)), [value])
  const commit = (): void => {
    const n = Number(draft)
    if (Number.isFinite(n) && n >= 0) onCommit(Math.round(n * 100) / 100)
    else setDraft(value.toFixed(2))
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-3">$</span>
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={cn('ring-focus num h-9 w-full rounded-lg border border-line bg-black/30 pl-6 text-[13px] font-medium text-fg hover:border-line-2', suffix ? 'pr-14' : 'pr-3')}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-fg-3">{suffix}</span>}
    </div>
  )
}
