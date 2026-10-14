import { describe, expect, it, vi } from 'vitest'
import { chartUrl, createTvCore, isAuthHost, layoutOf, SIGN_IN_URL, switchScript, tvSymbol, type TvViewPort } from '../src/main/tv-core'

/** inPage: what the page's own chart API answers (false = no API yet / switch failed, the core then loads the URL). */
function fakePort(inPage: (symbol: string, interval: string) => Promise<boolean> = async () => false): TvViewPort & { calls: string[]; url: string } {
  const port = {
    calls: [] as string[],
    url: '',
    async switchInPage(symbol: string, interval: string) {
      port.calls.push(`switch ${symbol} ${interval}`)
      return inPage(symbol, interval)
    },
    attached: false,
    attach() { port.attached = true; port.calls.push('attach') },
    detach() { port.attached = false; port.calls.push('detach') },
    setBounds(b: { x: number; y: number; width: number; height: number }) { port.calls.push(`bounds ${b.x},${b.y},${b.width},${b.height}`) },
    load(url: string) { port.url = url; port.calls.push(`load ${url}`) },
    currentUrl() { return port.url },
    back() { port.calls.push('back') },
    reload() { port.calls.push('reload') },
    openExternal(url: string) { port.calls.push(`external ${url}`) }
  }
  return port
}

describe('chartUrl', () => {
  it('builds the symbol and interval', () => {
    expect(chartUrl('nvda', 'D')).toBe('https://www.tradingview.com/chart/?symbol=NVDA&interval=D')
    expect(chartUrl('BRK.B', '60')).toBe('https://www.tradingview.com/chart/?symbol=BRK.B&interval=60')
  })

  it("uses TradingView's spelling for class shares and keeps your saved layout", () => {
    expect(tvSymbol('brk-b')).toBe('BRK.B')
    expect(chartUrl('BRK-B', 'D', 'AbC123xy')).toBe('https://www.tradingview.com/chart/AbC123xy/?symbol=BRK.B&interval=D')
    expect(layoutOf('https://www.tradingview.com/chart/AbC123xy/?symbol=AAPL')).toBe('AbC123xy')
    expect(layoutOf('https://www.tradingview.com/chart/?symbol=AAPL')).toBeNull()
    expect(layoutOf('not a url')).toBeNull()
  })

  it('the in-page script carries only the escaped symbol and interval', () => {
    const js = switchScript('BRK.B', '60')
    expect(js).toContain('"BRK.B"')
    expect(js).toContain('"60"')
    expect(js).toContain('TradingViewApi')
  })
})

describe('tv core', () => {
  it('setBounds attaches once and rounds', () => {
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.setBounds({ x: 10.4, y: 20.6, width: 800.5, height: 600.2 })
    tv.setBounds({ x: 10, y: 21, width: 801, height: 600 })
    expect(p.calls.filter((c) => c === 'attach')).toHaveLength(1)
    expect(p.calls).toContain('bounds 10,21,801,600')
  })

  it('hide() leaves the view detached', () => {
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    tv.setBounds(null)
    expect(p.calls.at(-1)).toBe('detach')
    tv.setBounds(null)
    expect(p.calls.filter((c) => c === 'detach')).toHaveLength(1)
  })

  it('ignores zero-size bounds (pane not laid out yet)', () => {
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    expect(p.calls).toEqual([])
  })

  it('first attach loads the chart; without the in-page API show loads the URL and skips a repeat', async () => {
    vi.useFakeTimers()
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 150 })
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    expect(p.calls.some((c) => c.startsWith('load https://www.tradingview.com/chart/'))).toBe(true)
    tv.show('NVDA', 'D')
    await vi.advanceTimersByTimeAsync(200)
    const loads = () => p.calls.filter((c) => c.startsWith('load ')).length
    const n = loads()
    tv.show('NVDA', 'D')
    await vi.advanceTimersByTimeAsync(200)
    expect(loads()).toBe(n)
    tv.show('AMD', '60')
    tv.show('TSLA', 'D')                               // rapid clicks: only the last one runs
    await vi.advanceTimersByTimeAsync(200)
    expect(loads()).toBe(n + 1)
    expect(p.url).toBe(chartUrl('TSLA', 'D'))
    expect(p.calls.filter((c) => c.startsWith('switch AMD'))).toHaveLength(0)
    vi.useRealTimers()
  })

  it('switches the loaded chart in place (no reload) and reports the symbol', async () => {
    const p = fakePort(async () => true)
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    const loadsBefore = p.calls.filter((c) => c.startsWith('load ')).length
    tv.show('brk-b', '240')
    await vi.waitFor(() => expect(p.calls).toContain('switch BRK.B 240'))
    expect(p.calls.filter((c) => c.startsWith('load ')).length).toBe(loadsBefore)
    expect(tv.symbol()).toBe('BRK-B')
  })

  it('a failed in-page switch falls back to loading the URL in the same layout', async () => {
    const p = fakePort(async () => false)
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    p.url = 'https://www.tradingview.com/chart/Lay0ut99/?symbol=AAPL&interval=D'   // you picked a saved layout
    tv.show('NVDA', '60')
    await vi.waitFor(() => expect(p.url).toBe(chartUrl('NVDA', '60', 'Lay0ut99')))
  })

  it('a slow switch that a newer click overtook does not reload the page', async () => {
    let release: (ok: boolean) => void = () => undefined
    const first = new Promise<boolean>((r) => { release = r })
    const answers = [first, Promise.resolve(true)]
    const p = fakePort(() => answers.shift() ?? Promise.resolve(true))
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    const loadsBefore = p.calls.filter((c) => c.startsWith('load ')).length
    tv.show('AMD', 'D')
    tv.show('TSLA', 'D')
    await vi.waitFor(() => expect(p.calls).toContain('switch TSLA D'))
    release(false)                                    // AMD's switch lost to TSLA: ignored
    await new Promise((r) => setTimeout(r, 0))
    expect(p.calls.filter((c) => c.startsWith('load ')).length).toBe(loadsBefore)
    expect(tv.symbol()).toBe('TSLA')
  })

  it("sign-in opens TradingView's sign-in page, and the chart comes back once signed in", () => {
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.show('AAPL', 'D')
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    tv.sessionChanged(false)
    tv.signIn()
    expect(p.url).toBe(SIGN_IN_URL)
    tv.sessionChanged(false)                          // still typing the password
    expect(p.url).toBe(SIGN_IN_URL)
    tv.sessionChanged(true)
    expect(p.url).toBe(chartUrl('AAPL', 'D'))
  })

  it('signing in from the chart page itself does not reload it', () => {
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    const loads = p.calls.filter((c) => c.startsWith('load ')).length
    tv.sessionChanged(false)
    tv.sessionChanged(true)                           // TradingView's own dialog on the chart: it refreshes itself
    expect(p.calls.filter((c) => c.startsWith('load ')).length).toBe(loads)
  })

  it('reload and open-in-browser use the chart you are looking at', () => {
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.show('AAPL', 'D')
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    p.url = 'https://www.tradingview.com/chart/?symbol=OLD&interval=D'   // stale address after an in-page switch
    tv.reload()
    expect(p.url).toBe(chartUrl('AAPL', 'D'))
    tv.openExternal()
    expect(p.calls.at(-1)).toBe(`external ${chartUrl('AAPL', 'D')}`)
  })

  it('show before the pane exists remembers the symbol for the first load', () => {
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.show('AAPL', 'D')
    expect(p.calls).toEqual([])
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    expect(p.url).toBe(chartUrl('AAPL', 'D'))
  })

  it('rejects bad tickers', () => {
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    tv.setBounds({ x: 0, y: 0, width: 100, height: 100 })
    const before = p.calls.length
    tv.show('javascript:alert(1)', 'D')
    tv.show('', 'D')
    expect(p.calls.length).toBe(before)
  })

  it('external links leave the app; sign-in popups stay', () => {
    expect(isAuthHost('https://accounts.google.com/o/oauth2/auth?x=1')).toBe(true)
    expect(isAuthHost('https://www.tradingview.com/accounts/signin/')).toBe(true)
    expect(isAuthHost('https://appleid.apple.com/auth')).toBe(true)
    expect(isAuthHost('https://www.reuters.com/markets')).toBe(false)
    expect(isAuthHost('https://evil.com/?x=tradingview.com')).toBe(false)
    const p = fakePort()
    const tv = createTvCore(p, { debounceMs: 0 })
    expect(tv.popup('https://www.reuters.com/markets')).toBe('external')
    expect(p.calls).toContain('external https://www.reuters.com/markets')
    expect(tv.popup('https://accounts.google.com/o/oauth2/auth')).toBe('allow')
  })
})
