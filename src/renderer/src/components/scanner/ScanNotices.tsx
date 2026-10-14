/** The notes under the scanner header: last-trade prices, file warnings, what the last run skipped, a cancelled run. */
import type { Level, ScanResult, Signal, Tested } from '@shared/types'
import { ChevronDown, Clock, FlaskConical, Info, TriangleAlert, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { pct } from '../../lib/format'
import { testedText } from '../../lib/signals'
import { isStale, nyStampLabel, offHoursWord } from '../../lib/time'
import { Tip } from '../Tip'

function Note({ tone, icon, children, onClose }: { tone: 'warn' | 'plain'; icon: ReactNode; children: ReactNode; onClose?: () => void }): React.JSX.Element {
  return (
    <div
      role={tone === 'warn' ? 'status' : undefined}
      className={cn(
        'mx-4 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-snug',
        tone === 'warn' ? 'border-warn/30 bg-warn/[0.07] text-fg' : 'border-line bg-white/[0.03] text-fg-2'
      )}
    >
      <span className={cn('mt-[1px] shrink-0', tone === 'warn' ? 'text-warn' : 'text-fg-3')}>{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="ring-focus -m-0.5 rounded-md p-0.5 text-fg-3 hover:text-fg">
          <X size={13} />
        </button>
      )}
    </div>
  )
}

/** "Scanned before the open (9:26 AM ET): put prices are last trades…". */
export function offHoursText(result: ScanResult): string {
  const when = nyStampLabel(result.scannedAtNy)
  const at = isStale(result.scannedAtNy) ? `${when.day}, ${when.time}` : when.time
  return `Scanned ${offHoursWord(result.scannedAtNy)} (${at}): put prices are last trades. Run the scan again during market hours before you trade.`
}

/** One plain note for the whole list: the put prices are the scan's own, from when it ran. */
export function PriceSourceNote({ scanTime }: { scanTime: string }): React.JSX.Element {
  return (
    <Tip content={`Put prices are the scanner's, from when it ran (${scanTime}). Calculate fetches fresh Yahoo prices.`} align="end">
      <span tabIndex={0} className="ring-focus ml-auto inline-flex min-w-0 items-center gap-1.5 truncate rounded text-[11.5px] text-fg-3">
        <span className="size-1.5 shrink-0 rounded-full bg-fg-4" aria-hidden="true" />
        <span className="truncate">Put prices: from the scan</span>
      </span>
    </Tip>
  )
}

function RunNotes({ notes }: { notes: string[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="mx-4 mb-2 rounded-lg border border-warn/30 bg-warn/[0.07] text-[12px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="ring-focus flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left"
      >
        <TriangleAlert size={13} className="shrink-0 text-warn" />
        <span className="flex-1 text-fg">
          The last run skipped or dropped some stocks <span className="text-fg-3">({notes.length} note{notes.length === 1 ? '' : 's'})</span>
        </span>
        <ChevronDown size={14} className={cn('shrink-0 text-fg-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mono max-h-36 overflow-y-auto border-t border-warn/20 px-3 py-2 text-[11px] leading-relaxed text-fg-2">
          {notes.map((n) => (
            <li key={n} className="break-words">{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ScanNoticesProps {
  result: ScanResult | null
  notes: string[]
  cancelled: boolean
  refreshError: string | null
  onDismissCancelled: () => void
}

export function ScanNotices({ result, notes, cancelled, refreshError, onDismissCancelled }: ScanNoticesProps): React.JSX.Element {
  const warnings = [...(result?.warnings ?? []), ...(refreshError ? [refreshError] : [])]
  return (
    <>
      {cancelled && (
        <Note tone="plain" icon={<Info size={13} />} onClose={onDismissCancelled}>
          Scan cancelled. The list below is still the last finished scan.
        </Note>
      )}
      {result && !result.marketOpenAtScan && (
        <Note tone="warn" icon={<Clock size={13} />}>
          {offHoursText(result)}
        </Note>
      )}
      {warnings.length > 0 && (
        <Note tone="warn" icon={<TriangleAlert size={13} />}>
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Note>
      )}
      {notes.length > 0 && <RunNotes notes={notes} />}
    </>
  )
}

/** One line per level shown, only when the scanner writes the optional tested_* columns: its own backtest of that level. */
export function TestedLine({ signals }: { signals: readonly Signal[] }): React.JSX.Element | null {
  const byLevel = new Map<Level, Tested>()
  for (const s of signals) {
    if (s.tested && testedText(s.tested) && !byLevel.has(s.level)) byLevel.set(s.level, s.tested)
  }
  if (byLevel.size === 0) return null
  const levels = [...byLevel.entries()].sort((a, b) => b[0] - a[0])
  const tip =
    "The scanner's own backtest of every put it would have sold at that level, as written in the scan file (tested_* columns). " +
    'Avg = profit per trade as a share of the cash the put ties up. Past results say nothing certain about the next trade.'
  return (
    <Tip content={tip} align="start">
      <p tabIndex={0} className="ring-focus mx-4 mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md text-[11.5px] text-fg-3">
        <span className="inline-flex items-center gap-1.5 text-fg-2">
          <FlaskConical size={12} className="text-fg-3" />
          Scanner backtest
        </span>
        {levels.map(([lv, t]) => (
          <span key={lv} className="num">
            <span className="font-semibold text-fg-2">{lv}/3</span> {pct(t.putWon)} won, avg {pct(t.putAvg, 1, true)} of cash a trade
          </span>
        ))}
      </p>
    </Tip>
  )
}
