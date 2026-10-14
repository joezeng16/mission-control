/** TradingView pane logic without Electron: where the view sits, which chart it shows, which popups stay in the app.
 *  tv.ts binds it to a real WebContentsView. */
import type { Bounds, TvInterval } from '../shared/types'

export interface TvViewPort {
  attach(): void
  detach(): void
  setBounds(b: Bounds): void
  load(url: string): void
  currentUrl(): string
  back(): void
  reload(): void
  openExternal(url: string): void
  /** Switches the open chart in place through TradingView's own page API (no reload); false when that isn't possible. */
  switchInPage(symbol: string, interval: TvInterval): Promise<boolean>
}

export interface TvCore {
  setBounds(b: Bounds | null): void
  show(ticker: string, interval: TvInterval): void
  /** The ticker the pane was last asked to show (the address bar goes stale after an in-place switch). */
  symbol(): string | null
  back(): void
  reload(): void
  openExternal(): void
  popup(url: string): 'allow' | 'external'
  /** Opens TradingView's sign-in page in the pane. */
  signIn(): void
  /** Called with every session check: right after you sign in (away from the chart), the chart comes back. */
  sessionChanged(signedIn: boolean): void
}

const HOME = 'https://www.tradingview.com/chart/'
export const SIGN_IN_URL = 'https://www.tradingview.com/accounts/signin/'
const TICKER = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/
const LAYOUT = /^\/chart\/([A-Za-z0-9]{4,})\/?$/
// sign-in popups (TradingView itself, Google, Apple, Facebook, X) stay inside the app so the session is shared
const AUTH_HOSTS = ['tradingview.com', 'accounts.google.com', 'appleid.apple.com', 'facebook.com', 'x.com', 'twitter.com']

/** TradingView spells class shares with a dot where Yahoo (and most scanners) use a dash: BRK-B -> BRK.B. */
export const tvSymbol = (ticker: string): string => ticker.trim().toUpperCase().replace(/-/g, '.')

/** The saved chart layout in a TradingView address (/chart/<id>/), or null for the default chart. */
export function layoutOf(url: string): string | null {
  try {
    return LAYOUT.exec(new URL(url).pathname)?.[1] ?? null
  } catch {
    return null
  }
}

export function chartUrl(ticker: string, interval: TvInterval, layout: string | null = null): string {
  return `${HOME}${layout ? `${layout}/` : ''}?symbol=${encodeURIComponent(tvSymbol(ticker))}&interval=${interval}`
}

/** Runs inside tradingview.com: sets the active chart's symbol and interval, true once both show. Gives up after 4 s
 *  (unknown symbol, page still starting), and the caller then loads the chart's address instead. */
export function switchScript(symbol: string, interval: TvInterval): string {
  return `(async (sym, res) => {
  const api = window.TradingViewApi
  if (!api || typeof api.activeChart !== 'function') return false
  const chart = api.activeChart()
  const bare = (s) => String(s || '').split(':').pop().toUpperCase()
  const step = (run) => new Promise((ok) => {
    const t = setTimeout(() => ok(false), 4000)
    try { run(() => { clearTimeout(t); ok(true) }) } catch { clearTimeout(t); ok(false) }
  })
  if (bare(chart.symbol()) !== sym && !(await step((done) => chart.setSymbol(sym, done)))) return false
  if (String(chart.resolution()) !== res && !(await step((done) => chart.setResolution(res, done)))) return false
  return bare(chart.symbol()) === sym && String(chart.resolution()) === res
})(${JSON.stringify(symbol)}, ${JSON.stringify(interval)})`
}

export function isAuthHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return AUTH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

export function createTvCore(port: TvViewPort, opts: { debounceMs?: number } = {}): TvCore {
  const debounceMs = opts.debounceMs ?? 150
  let attached = false
  let loaded = false
  let wanted: { ticker: string; interval: TvInterval } | null = null   // chart asked for (may arrive before the pane exists)
  let layout: string | null = null                                     // your saved chart layout, kept across reloads
  let request = 0                                                      // newest show(): older switch results are ignored
  let timer: ReturnType<typeof setTimeout> | null = null
  let signedIn: boolean | null = null

  const wantedUrl = (): string => {
    layout = layoutOf(port.currentUrl()) ?? layout
    return wanted ? chartUrl(wanted.ticker, wanted.interval, layout) : HOME
  }

  const loadWanted = (): void => {
    const url = wantedUrl()
    if (port.currentUrl() !== url) port.load(url)
    loaded = true
  }

  const go = async (): Promise<void> => {
    timer = null
    const mine = ++request
    if (loaded && wanted) {
      const ok = await port.switchInPage(tvSymbol(wanted.ticker), wanted.interval).catch(() => false)
      if (mine !== request || ok) return                               // a newer click took over, or done in place
    }
    loadWanted()
  }

  return {
    setBounds(b) {
      if (b === null) {
        if (attached) port.detach()
        attached = false
        return
      }
      const r = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
      if (r.width < 1 || r.height < 1) return
      if (!attached) port.attach()
      attached = true
      port.setBounds(r)
      if (!loaded) loadWanted()
    },
    show(ticker, interval) {
      if (!TICKER.test(ticker.trim())) return
      wanted = { ticker: ticker.trim().toUpperCase(), interval }
      if (!attached) return                   // loads when the pane appears
      if (timer) clearTimeout(timer)
      if (debounceMs <= 0) void go()
      else timer = setTimeout(() => void go(), debounceMs)
    },
    symbol: () => wanted?.ticker ?? null,
    back: () => port.back(),
    reload: () => (wanted ? port.load(wantedUrl()) : port.reload()),
    openExternal: () => port.openExternal(wanted ? wantedUrl() : port.currentUrl() || HOME),
    popup(url) {
      if (isAuthHost(url)) return 'allow'
      port.openExternal(url)
      return 'external'
    },
    signIn: () => port.load(SIGN_IN_URL),
    sessionChanged(now) {
      const justSignedIn = signedIn === false && now
      signedIn = now
      if (!justSignedIn) return
      let onChart = false
      try {
        onChart = new URL(port.currentUrl()).pathname.startsWith('/chart')
      } catch {
        onChart = false
      }
      if (!onChart) port.load(wantedUrl())           // the sign-in page (or wherever it landed) -> back to the chart
    }
  }
}
