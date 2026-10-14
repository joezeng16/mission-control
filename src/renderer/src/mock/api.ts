/**
 * A browser-only McApi with realistic delays and made-up data, so the UI runs without Electron (npm run dev:web).
 * URL switches: ?mock=live opens on the live sample scan (default: the pre-open one); ?tv=out = TradingView signed out;
 * ?clock=open / ?clock=closed shifts the app clock to 10:30 AM / 7:00 PM New York time today (market-hours screens on any
 * weekday).
 */
import type { McApi, ScanProgress, ScanResult, ScanRunOutcome, TvInterval, TvState } from '@shared/types'
import { setPreviewClockOffset } from '../lib/clock'
import { nyStamp } from '../lib/time'
import { mockChain, mockExpirations, mockQuote } from './market'
import { sampleLive, samplePreOpen } from './signals'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const SCRIPT_LINES: string[] = [
  'Example scanner 1.0: 8 sample tickers, last 5 trading days',
  'Checking the rules on every ticker...',
  'Hits: 4 tagged, 1 forming, 1 near miss',
  'Pricing puts (made-up numbers)...',
  'Too new for the scanner (1): NEWCO',
  'Saved scans/signals_scan.csv and signals_exits.csv'
]

function param(name: string): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name)
}

/** Minutes past midnight in New York right now (real clock). */
function nyMinutesNow(): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return (get('hour') % 24) * 60 + get('minute')
}

/** ?clock=open | closed: move the app clock to 10:30 AM or 7:00 PM New York time today (preview only). */
function applyPreviewClock(): void {
  const want = param('clock') === 'open' ? 10 * 60 + 30 : param('clock') === 'closed' ? 19 * 60 : null
  if (want != null) setPreviewClockOffset((want - nyMinutesNow()) * 60_000)
}

/** Same rule as the main process: a weekday between 9:30 AM and 4:00 PM New York. */
function openAt(ny: string): boolean {
  const day = new Date(`${ny.slice(0, 10)}T12:00:00Z`).getUTCDay()
  const hm = ny.slice(11, 16)
  return day >= 1 && day <= 5 && hm >= '09:30' && hm < '16:00'
}

/** A run "now": live quotes during market hours, last trades otherwise (like a real scanner). */
function freshRun(): ScanResult {
  const stamp = nyStamp()
  const open = openAt(stamp)
  const base = open ? sampleLive : samplePreOpen
  const file = `signals_scan_${stamp.replace(' ', '_').replace(':', '')}.csv`
  return { ...base, file, scannedAtNy: stamp, marketOpenAtScan: open }
}

export function createMockApi(): McApi {
  applyPreviewClock()
  const progress = new Set<(p: ScanProgress) => void>()
  const tvListeners = new Set<(s: TvState) => void>()
  let running = false
  let cancelled = false
  let latest: ScanResult | null = param('mock') === 'live' ? sampleLive : samplePreOpen
  let signedIn: boolean | null = param('tv') === 'out' ? false : null
  let tv: TvState = { url: 'https://www.tradingview.com/chart/', symbol: null, loading: false, signedIn }
  let loadTimer: ReturnType<typeof setTimeout> | undefined

  const emitTv = (next: TvState): void => {
    tv = next
    tvListeners.forEach((cb) => cb(tv))
  }
  const fakeLoad = (next: Omit<TvState, 'loading'>): void => {
    emitTv({ ...next, loading: true })
    clearTimeout(loadTimer)
    loadTimer = setTimeout(() => emitTv({ ...tv, loading: false }), 650)
  }

  async function run(): Promise<ScanRunOutcome> {
    if (running) return { ok: false, code: null, tail: [], result: null, error: 'A scan is already running.' }
    running = true
    cancelled = false
    const tail: string[] = []
    try {
      for (const line of SCRIPT_LINES) {
        await wait(420 + Math.random() * 260)
        if (cancelled) return { ok: false, code: null, tail, result: null, error: 'The scan was cancelled.', cancelled: true }
        tail.push(line)
        progress.forEach((cb) => cb({ line }))
      }
      latest = freshRun()
      return { ok: true, code: 0, tail, result: latest, error: null }
    } finally {
      running = false
    }
  }

  return {
    scanner: {
      latest: async () => {
        await wait(320)
        return latest
      },
      run,
      cancel: async () => {
        cancelled = true
      },
      onProgress: (cb) => {
        progress.add(cb)
        return () => progress.delete(cb)
      }
    },
    market: {
      quote: async (ticker) => {
        await wait(260)
        return mockQuote(ticker)
      },
      expirations: async (ticker) => {
        await wait(180)
        return mockExpirations(ticker)
      },
      chain: async (ticker, expiry) => {
        await wait(380)
        return mockChain(ticker, expiry)
      }
    },
    tv: {
      setBounds: () => undefined,
      show: (ticker: string, interval: TvInterval) => {
        if (tv.symbol === ticker && tv.url.endsWith(`interval=${interval}`)) return
        fakeLoad({ url: `https://www.tradingview.com/chart/?symbol=${ticker}&interval=${interval}`, symbol: ticker, signedIn })
      },
      back: () => fakeLoad({ ...tv }),
      reload: () => fakeLoad({ ...tv }),
      openExternal: () => {
        window.open(tv.url, '_blank', 'noopener,noreferrer')
      },
      signIn: () => {
        signedIn = true
        fakeLoad({ ...tv, signedIn })
      },
      onState: (cb) => {
        tvListeners.add(cb)
        cb(tv)
        return () => tvListeners.delete(cb)
      }
    }
  }
}
