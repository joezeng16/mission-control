import type { Quote } from '@shared/types'
import { ArrowDownRight, ArrowUpRight, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { cn } from '../../lib/cn'
import { pct, price } from '../../lib/format'

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/

interface TickerSearchProps {
  ticker: string
  quote: Quote | null
  loading: boolean
  onSubmit: (ticker: string) => void
}

/** Ticker box plus the live price and day change. Keyed by ticker in the parent, so the box resets on a new stock. */
export function TickerSearch({ ticker, quote, loading, onSubmit }: TickerSearchProps): React.JSX.Element {
  const [draft, setDraft] = useState(ticker)
  const [bad, setBad] = useState(false)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const t = draft.trim().toUpperCase()
    if (!TICKER.test(t)) {
      setBad(true)
      return
    }
    setBad(false)
    onSubmit(t)
  }
  const up = (quote?.change ?? 0) >= 0
  const Arrow = up ? ArrowUpRight : ArrowDownRight
  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          aria-label="Stock symbol"
          aria-invalid={bad}
          spellCheck={false}
          placeholder="Search a stock, e.g. NVDA"
          className={cn(
            'ring-focus num h-10 w-full rounded-xl border bg-black/35 pl-9 pr-16 text-[14px] font-medium text-fg placeholder:font-normal placeholder:text-fg-3',
            bad ? 'border-loss/60' : 'border-line hover:border-line-2'
          )}
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-[10.5px] text-fg-3">Enter</kbd>
      </form>
      {bad && <p className="-mt-1 text-[11.5px] text-loss">Type a stock symbol like NVDA.</p>}
      <div className={cn('flex items-end justify-between gap-3 transition-opacity', loading && !quote && 'opacity-40')}>
        <div className="min-w-0">
          <div className="text-[22px] font-semibold leading-none tracking-[-0.03em]">{quote?.ticker ?? ticker}</div>
          <div className="mt-1.5 truncate text-[12px] text-fg-3">{quote?.name ?? (loading ? 'Loading…' : 'Stock')}</div>
        </div>
        {quote && (
          <div className="text-right">
            <div className="num text-[20px] font-semibold leading-none tracking-tight">{price(quote.price)}</div>
            <div className={cn('num mt-1.5 inline-flex items-center gap-0.5 text-[12px] font-medium', up ? 'text-profit' : 'text-loss')}>
              <Arrow size={13} />
              {price(Math.abs(quote.change)).replace('$', up ? '+$' : '−$')} ({pct(quote.changePct, 2, true)})
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
