import type { TvInterval } from '@shared/types'
import { ArrowLeft, ExternalLink, LoaderCircle, RotateCw, Search } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { Segmented } from '../Segmented'
import { Tip } from '../Tip'

export const INTERVALS: { value: TvInterval; label: string; long: string }[] = [
  { value: 'D', label: 'D', long: 'Daily' },
  { value: '240', label: '4h', long: '4-hour' },
  { value: '60', label: '1h', long: 'Hourly' },
  { value: '30', label: '30m', long: '30-minute' }
]

export function intervalLong(i: TvInterval): string {
  return INTERVALS.find((x) => x.value === i)?.long ?? 'Daily'
}

interface TvToolbarProps {
  symbol: string | null
  interval: TvInterval
  loading: boolean
  onInterval: (i: TvInterval) => void
  /** Show a box to jump to any symbol (TradingView tab). */
  onSymbol?: (symbol: string) => void
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }): React.JSX.Element {
  return (
    // side="left": the native TradingView view is drawn over the page, so a tooltip below the toolbar would be hidden.
    <Tip content={label} side="left">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="ring-focus grid size-7 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-white/[0.07] hover:text-fg"
      >
        {children}
      </button>
    </Tip>
  )
}

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/

export function TvToolbar({ symbol, interval, loading, onInterval, onSymbol }: TvToolbarProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const t = draft.trim().toUpperCase()
    if (!TICKER.test(t) || !onSymbol) return
    onSymbol(t)
    setDraft('')
  }
  return (
    <div className="relative flex h-11 shrink-0 items-center gap-2 px-2">
      {onSymbol ? (
        <form onSubmit={submit} className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            placeholder={symbol ?? 'Symbol'}
            aria-label="Open a symbol"
            spellCheck={false}
            className="ring-focus num h-7 w-[150px] rounded-lg border border-line bg-black/30 pl-7 pr-2 text-[12.5px] text-fg placeholder:text-fg-2"
          />
        </form>
      ) : (
        <div className="flex items-baseline gap-2 pl-1">
          <span className="text-[14px] font-semibold tracking-tight">{symbol ?? 'No stock'}</span>
          <span className="text-[11.5px] text-fg-3">on TradingView</span>
        </div>
      )}
      <Segmented
        size="sm"
        label="Chart interval"
        value={interval}
        onChange={onInterval}
        options={INTERVALS.map((i) => ({ value: i.value, label: i.label, title: i.long }))}
      />
      <div className="ml-auto flex items-center gap-0.5">
        {loading && <LoaderCircle size={14} className="mr-1 animate-spin text-profit" aria-label="Loading" />}
        <IconButton label="Back" onClick={() => api.tv.back()}>
          <ArrowLeft size={15} />
        </IconButton>
        <IconButton label="Reload" onClick={() => api.tv.reload()}>
          <RotateCw size={14} />
        </IconButton>
        <IconButton label="Open in your browser" onClick={() => api.tv.openExternal()}>
          <ExternalLink size={14} />
        </IconButton>
      </div>
      <div className={cn('absolute inset-x-3 bottom-0 h-px overflow-hidden', loading ? 'bg-white/[0.04]' : 'bg-transparent')}>
        {loading && <div className="h-full w-1/3 animate-sweep bg-gradient-to-r from-transparent via-profit to-transparent" />}
      </div>
    </div>
  )
}
