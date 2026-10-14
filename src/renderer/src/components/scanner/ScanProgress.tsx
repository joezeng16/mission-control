import { CircleAlert, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { ScanFailure } from '../../lib/scannerStore'

function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since == null) return undefined
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [since])
  if (since == null) return '0:00'
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

interface ScanProgressProps {
  running: boolean
  lines: string[]
  startedAt: number | null
  onCancel: () => void
}

/** The live strip under the header while a scan runs: the scanner's latest line, elapsed time, Cancel. */
export function ScanProgress({ running, lines, startedAt, onCancel }: ScanProgressProps): React.JSX.Element {
  const elapsed = useElapsed(running ? startedAt : null)
  const latest = lines.at(-1) ?? 'Starting the scanner…'
  return (
    <AnimatePresence initial={false}>
      {running && (
        <motion.div
          key="progress"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden px-4"
        >
          <div className="mb-3 overflow-hidden rounded-xl border border-profit/25 bg-profit/[0.05]">
            <div className="relative h-[2px] overflow-hidden bg-profit/10">
              <div className="absolute inset-y-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-profit to-transparent" />
            </div>
            <div className="flex items-center gap-3 px-3 py-2">
              <span className="mono shrink-0 text-[11.5px] text-profit">{elapsed}</span>
              <span className="min-w-0 flex-1 overflow-hidden" aria-live="polite">
                <motion.span
                  key={latest}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="mono block truncate text-[12px] text-fg-2"
                >
                  {latest}
                </motion.span>
              </span>
              <button
                type="button"
                onClick={onCancel}
                className="ring-focus btn-ghost inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium"
              >
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface ScanFailureProps {
  failure: ScanFailure | null
  onDismiss: () => void
}

/** When a scan fails: one plain sentence and the scanner's last 20 output lines. */
export function ScanFailurePanel({ failure, onDismiss }: ScanFailureProps): React.JSX.Element | null {
  if (!failure) return null
  return (
    <div className="mx-4 mb-3 rounded-xl border border-loss/30 bg-loss/[0.06] p-3">
      <div className="flex items-start gap-2">
        <CircleAlert size={15} className="mt-0.5 shrink-0 text-loss" />
        <p className="flex-1 text-[12.5px] text-fg">{failure.message}</p>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ring-focus rounded-md p-0.5 text-fg-3 hover:text-fg">
          <X size={14} />
        </button>
      </div>
      {failure.tail.length > 0 && (
        <pre className="mono mt-2 max-h-40 overflow-auto rounded-lg bg-black/40 p-2 text-[11px] leading-relaxed text-fg-2">
          {failure.tail.join('\n')}
        </pre>
      )}
    </div>
  )
}
