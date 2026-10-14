import type { ScanResult } from '@shared/types'
import { Activity, Clock, LoaderCircle, Play } from 'lucide-react'
import { SCAN_DAYS_BACK } from '@shared/defaults'
import { cn } from '../../lib/cn'
import { isStale, nyStampLabel } from '../../lib/time'
import { useMarketOpen } from '../../lib/useClock'
import { Tip } from '../Tip'

const TITLE = 'Signals'
const SUB = `Your scanner's signals, last ${SCAN_DAYS_BACK} trading days`

interface ScanHeaderProps {
  result: ScanResult | null
  running: boolean
  onRun: () => void
}

type ChipProps = React.ComponentPropsWithRef<'span'> & { tone?: 'plain' | 'warn' }

/** A header chip. It passes ref and handlers through, so it can be a tooltip trigger (Tip uses asChild). */
function Chip({ children, tone = 'plain', className, ...rest }: ChipProps): React.JSX.Element {
  return (
    <span
      tabIndex={0}
      {...rest}
      className={cn(
        'ring-focus inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[12px]',
        tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line bg-white/[0.03] text-fg-2',
        className
      )}
    >
      {children}
    </span>
  )
}

function VersionChip({ version }: { version: string | null }): React.JSX.Element {
  const tip = version ? `Scanner version: ${version}` : 'This scan file does not say which scanner made it (no `scanner` column).'
  return (
    <Tip content={tip} side="bottom" align="start">
      <span
        tabIndex={0}
        className={cn(
          'ring-focus num inline-flex h-[18px] max-w-[180px] shrink-0 items-center truncate whitespace-nowrap rounded-md border px-1.5 text-[10.5px] font-medium leading-none',
          version ? 'border-line-2 bg-white/[0.04] text-fg-2' : 'border-warn/35 bg-warn/10 text-warn'
        )}
      >
        {version ?? 'version unknown'}
      </span>
    </Tip>
  )
}

export function ScanHeader({ result, running, onRun }: ScanHeaderProps): React.JSX.Element {
  const marketOpen = useMarketOpen()
  const when = result ? nyStampLabel(result.scannedAtNy) : null
  const stale = result ? isStale(result.scannedAtNy) : false
  const offHours = result != null && !result.marketOpenAtScan
  // Glow only when a new run would show something new: no scan, an old scan, or last-trade prices while the market is open now.
  const glow = !running && (result == null || stale || (offHours && marketOpen))
  return (
    <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-profit/30 bg-gradient-to-b from-profit/25 to-profit/5 text-profit shadow-[0_0_24px_-6px_rgb(0_200_5/0.7),inset_0_1px_0_rgb(255_255_255/0.15)]">
        <Activity size={19} strokeWidth={2.1} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.02em]">{TITLE}</h1>
          {result && <VersionChip version={result.version} />}
        </div>
        <p className="truncate text-[12px] text-fg-3">{SUB}</p>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {when && (
          <Tip content={`Last scan ${when.day}, ${when.time}${stale ? '. Not from today: press Run scan.' : ''}`}>
            <Chip tone={stale ? 'warn' : 'plain'}>
              <Clock size={12} className="shrink-0" />
              <span className="num">{stale ? `Old: ${when.day.replace(/^\w+, /, '')}` : when.time}</span>
            </Chip>
          </Tip>
        )}
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className={cn(
            'ring-focus inline-flex h-8 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[12.5px] font-semibold transition-[filter,opacity]',
            running ? 'btn-ghost cursor-default' : glow ? 'btn-primary' : 'btn-ghost'
          )}
        >
          {running ? <LoaderCircle size={14} className="animate-spin text-profit" /> : <Play size={13} fill="currentColor" className={glow ? undefined : 'text-profit'} />}
          {running ? 'Scanning…' : 'Run scan'}
        </button>
      </div>
    </div>
  )
}
