import { SCAN_DAYS_BACK } from '@shared/defaults'
import type { ExitRow, Signal, TvInterval } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { ExitsList } from '../components/scanner/ExitsList'
import { ScanHeader } from '../components/scanner/ScanHeader'
import { PriceSourceNote, ScanNotices, TestedLine } from '../components/scanner/ScanNotices'
import type { PriceSource } from '../components/scanner/SignalCells'
import { ScanFailurePanel, ScanProgress } from '../components/scanner/ScanProgress'
import type { DateMode } from '../components/scanner/SignalRow'
import { SignalsTable, TableSkeleton, signalKey } from '../components/scanner/SignalsTable'
import { Segmented } from '../components/Segmented'
import { Split } from '../components/Split'
import { TvPane } from '../components/tv/TvPane'
import { TvToolbar, intervalLong } from '../components/tv/TvToolbar'
import { api } from '../lib/api'
import { cn } from '../lib/cn'
import { scannerActions, useScanner, type ScannerState } from '../lib/scannerStore'
import { LEVEL_FILTERS, calcRequestFor, passesFilter, sortExits, sortSignals } from '../lib/signals'
import { isStale, nyStampLabel } from '../lib/time'
import { useTvState } from '../lib/useTvState'

import type { CalcRequest } from '../lib/calcRequest'
export type { CalcRequest } from '../lib/calcRequest'

interface ScannerTabProps {
  active: boolean
  onCalculate: (req: Omit<CalcRequest, 'nonce'>) => void
}

/** The rows shown: the scan's signals, filtered and sorted; near misses in their own group. */
function useRows(st: ScannerState): { main: Signal[]; near: Signal[]; all: number } {
  return useMemo(() => {
    const signals = st.result?.signals ?? []
    const visible = signals.filter((s) => passesFilter(s.level, st.filter))
    const sorted = sortSignals(visible, st.sort)
    return { main: sorted.filter((s) => s.kind !== 'near'), near: sorted.filter((s) => s.kind === 'near'), all: signals.length }
  }, [st.result, st.filter, st.sort])
}

/** Rows say "Today" / "3d ago" only when that is true right now and the quotes were live. */
function dateModeOf(st: ScannerState): DateMode {
  if (!st.result) return 'relative'
  if (isStale(st.result.scannedAtNy)) return 'all'
  return st.result.marketOpenAtScan ? 'relative' : 'today'
}

/** Re-read the newest scan file when the tab opens and when the window comes back (a scan run outside the app may have
 *  saved one). */
function useFreshScan(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined
    void scannerActions.refresh()
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => void scannerActions.refresh(), 400)
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') later()
    }
    window.addEventListener('focus', later)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', later)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
}

function EmptyLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-4 py-10 text-center text-[13px] text-fg-3">{children}</p>
}

export function ScannerTab({ active, onCalculate }: ScannerTabProps): React.JSX.Element {
  const st = useScanner()
  const tv = useTvState()
  const [dragging, setDragging] = useState(false)
  const [interval, setTvInterval] = useState<TvInterval>('D')
  const rows = useRows(st)
  const src: PriceSource = { scanTime: st.result ? nyStampLabel(st.result.scannedAtNy).time : 'the scan' }
  const shown = [...rows.main, ...rows.near]
  const exits = useMemo(() => sortExits(st.result?.exits ?? []), [st.result])

  useEffect(() => {
    if (st.status === 'idle') void scannerActions.load()
  }, [st.status])
  useFreshScan(active)

  const selectSignal = (s: Signal): void => {
    scannerActions.select(signalKey(s))
    api.tv.show(s.ticker, interval)
  }
  const selectExit = (e: ExitRow): void => {
    scannerActions.select(`${e.ticker}|exit`)
    api.tv.show(e.ticker, interval)
  }

  // Open the top signal on the chart the first time results arrive.
  const first = rows.main[0] ?? rows.near[0]
  useEffect(() => {
    if (!active || st.selected || !first) return
    scannerActions.select(signalKey(first))
    api.tv.show(first.ticker, interval)
  }, [active, st.selected, first, interval])

  const selectedTicker = st.selected?.split('|')[0] ?? null
  // Coming back to this tab: put the chart back on the highlighted row and interval.
  useEffect(() => {
    if (active && selectedTicker) api.tv.show(selectedTicker, interval)
    // only on activation: selection and interval changes already move the chart themselves
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps
  const symbol = tv.symbol ?? selectedTicker
  const changeInterval = (i: TvInterval): void => {
    setTvInterval(i)
    if (symbol) api.tv.show(symbol, i)
  }

  const loading = st.status === 'idle' || st.status === 'loading'
  const exitsEmpty = !loading && exits.length === 0
  const body = loading ? (
    <>
      <TableSkeleton />
      <p className="px-4 text-center text-[12.5px] text-fg-3">Loading the latest scan…</p>
    </>
  ) : st.status === 'error' ? (
    <EmptyLine>{st.loadError ?? "Couldn't read the scan files."}</EmptyLine>
  ) : !st.result ? (
    <EmptyLine>No scan yet. Press Run scan to run your scanner.</EmptyLine>
  ) : rows.all === 0 ? (
    <EmptyLine>No signals in the last {SCAN_DAYS_BACK} trading days.</EmptyLine>
  ) : rows.main.length + rows.near.length === 0 ? (
    <EmptyLine>No signals at this level right now. Pick All to see every level.</EmptyLine>
  ) : (
    <SignalsTable
      dateMode={dateModeOf(st)}
      rows={rows.main}
      nearRows={rows.near}
      src={src}
      sort={st.sort}
      onSort={(k) => scannerActions.sortBy(k)}
      selected={st.selected}
      onSelect={selectSignal}
      onCalculate={(s) => onCalculate(calcRequestFor(s))}
      revision={st.revision}
    />
  )

  const left = (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden">
      <ScanHeader result={st.result} running={st.running} onRun={() => void scannerActions.run()} />
      <ScanProgress running={st.running} lines={st.lines} startedAt={st.startedAt} onCancel={() => void scannerActions.cancel()} />
      <ScanFailurePanel failure={st.failure} onDismiss={() => scannerActions.dismissFailure()} />
      <ScanNotices
        result={st.result}
        notes={st.notes}
        cancelled={st.cancelled}
        refreshError={st.refreshError}
        onDismissCancelled={() => scannerActions.dismissCancelled()}
      />
      <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
        <Segmented label="Level filter" size="sm" value={st.filter} onChange={(f) => scannerActions.setFilter(f)} options={LEVEL_FILTERS} />
        <span className="num text-[11.5px] text-fg-3">
          {rows.main.length} signal{rows.main.length === 1 ? '' : 's'}
          {rows.near.length > 0 && `, ${rows.near.length} to check`}
        </span>
        {st.result && <PriceSourceNote scanTime={src.scanTime} />}
      </div>
      <TestedLine signals={shown} />
      {/* The signals take the room they need; the exits get the rest (or just their header when there are none). */}
      <div className={cn('min-h-[116px] overflow-y-auto border-t border-line', exitsEmpty ? 'flex-1' : 'flex-[0_1_auto]')}>{body}</div>
      <div className={cn('flex flex-col border-t border-line bg-black/[0.12]', exitsEmpty ? 'shrink-0' : 'min-h-[184px] flex-1')}>
        <ExitsList exits={exits} loading={loading} saved={st.result?.exitsSaved ?? true} selected={st.selected} onSelect={selectExit} />
      </div>
    </div>
  )

  const right = (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden p-1.5 pt-0">
      <TvToolbar symbol={symbol} interval={interval} loading={tv.loading} onInterval={changeInterval} />
      {active ? (
        <TvPane symbol={symbol} intervalLabel={intervalLong(interval)} loading={tv.loading} suspended={dragging} className="flex-1" />
      ) : (
        <div className="flex-1" />
      )}
    </div>
  )

  // 670 px keeps every column of the signals table whole.
  return <Split storageKey="mc.split.signals" minLeftPx={670} left={left} right={right} onDragChange={setDragging} />
}
