/**
 * Scanner state that outlives tab switches (a scan keeps running while you look at the calculator).
 * A tiny external store: immutable snapshots + useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react'
import type { ScanResult } from '@shared/types'
import { api } from './api'
import { DEFAULT_SORT, nextSort, notableLines, type LevelFilter, type SortKey, type SortState } from './signals'

export interface ScanFailure {
  message: string
  tail: string[]
}

export interface ScannerState {
  result: ScanResult | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  loadError: string | null
  running: boolean
  lines: string[]
  startedAt: number | null
  failure: ScanFailure | null
  /** Lines from the last run worth keeping (stocks not scanned, dropped, no close yet). Kept until the next run. */
  notes: string[]
  /** The last run was cancelled on purpose (not a failure). */
  cancelled: boolean
  /** Re-reading the newest scan file failed (the shown result is kept). */
  refreshError: string | null
  selected: string | null
  filter: LevelFilter
  sort: SortState
  revision: number
}

const initial = (): ScannerState => ({
  result: null,
  status: 'idle',
  loadError: null,
  running: false,
  lines: [],
  startedAt: null,
  failure: null,
  notes: [],
  cancelled: false,
  refreshError: null,
  selected: null,
  filter: 'all',
  sort: DEFAULT_SORT,
  revision: 0
})

let state: ScannerState = initial()
const listeners = new Set<() => void>()

function patch(next: Partial<ScannerState> | ((s: ScannerState) => Partial<ScannerState>)): void {
  const changes = typeof next === 'function' ? next(state) : next
  state = { ...state, ...changes }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

api.scanner.onProgress((p) => {
  if (!state.running) return
  patch((s) => ({ lines: [...s.lines, p.line].slice(-40), notes: notableLines([...s.notes, p.line]) }))
})

const REFRESH_GAP_MS = 1500
let lastRefresh = 0
let refreshing = false

function sameScan(a: ScanResult | null, b: ScanResult | null): boolean {
  return a?.file === b?.file && a?.scannedAtNy === b?.scannedAtNy
}

export function useScanner(): ScannerState {
  return useSyncExternalStore(subscribe, () => state)
}

/** The plain message, without the "Error invoking remote method 'scanner:latest': Error:" prefix Electron adds. */
function message(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '')
}

export const scannerActions = {
  async load(): Promise<void> {
    if (state.status === 'loading' || state.status === 'ready') return
    patch({ status: 'loading', loadError: null })
    try {
      const result = await api.scanner.latest()
      patch((s) => ({ result, status: 'ready', revision: s.revision + 1 }))
    } catch (err) {
      patch({ status: 'error', loadError: message(err) })
    }
  },

  /** Re-read the newest scan file (a scan run outside the app may have saved one). Quiet when nothing changed. */
  async refresh(): Promise<void> {
    if (state.status !== 'ready' || state.running || refreshing) return
    if (Date.now() - lastRefresh < REFRESH_GAP_MS) return
    refreshing = true
    lastRefresh = Date.now()
    try {
      const result = await api.scanner.latest()
      if (state.running || (sameScan(state.result, result) && state.refreshError === null)) return
      patch((s) => (sameScan(s.result, result) ? { refreshError: null } : { result, refreshError: null, revision: s.revision + 1 }))
    } catch (err) {
      console.error('Mission Control: re-reading the scan failed', err)
      patch({ refreshError: `Couldn't re-read the scan files: ${message(err)}` })
    } finally {
      refreshing = false
    }
  },

  async run(): Promise<void> {
    if (state.running) return
    patch({ running: true, lines: [], notes: [], cancelled: false, startedAt: Date.now(), failure: null })
    try {
      const out = await api.scanner.run()
      const notes = (s: ScannerState): string[] => notableLines([...s.notes, ...out.tail])
      if (out.ok && out.result) {
        patch((s) => ({ running: false, result: out.result, status: 'ready', loadError: null, notes: notes(s), refreshError: null, revision: s.revision + 1 }))
        return
      }
      const cancelled = out.cancelled === true
      patch((s) => ({
        running: false,
        cancelled,
        notes: cancelled ? [] : notes(s),
        failure: cancelled ? null : { message: out.error ?? `The scan stopped (exit code ${out.code ?? '?'}).`, tail: out.tail.slice(-20) },
        lines: cancelled ? [] : s.lines
      }))
    } catch (err) {
      patch((s) => ({ running: false, failure: { message: message(err), tail: s.lines.slice(-20) } }))
    }
  },

  async cancel(): Promise<void> {
    await api.scanner.cancel()
  },

  select(ticker: string | null): void {
    patch({ selected: ticker })
  },

  setFilter(filter: LevelFilter): void {
    patch({ filter })
  },

  sortBy(key: SortKey): void {
    patch((s) => ({ sort: nextSort(s.sort, key) }))
  },

  dismissFailure(): void {
    patch({ failure: null })
  },

  dismissCancelled(): void {
    patch({ cancelled: false })
  }
}
