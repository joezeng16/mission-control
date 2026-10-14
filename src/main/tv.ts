/** The real tradingview.com inside the app: one WebContentsView in its own persistent session (you sign in once,
 *  with your own account), placed over the renderer's pane. tradingview.com refuses iframes (frame-ancestors 'none'), a top-level view is allowed. */
import { BrowserWindow, WebContentsView, session, type WebContents } from 'electron'
import type { TvState } from '../shared/types'
import { openExternalSafe } from './safe-url'
import { createTvCore, isAuthHost, switchScript, type TvCore, type TvViewPort } from './tv-core'

export const TV_PARTITION = 'persist:tradingview'

/** A plain Chrome user agent for Electron's Chromium (no "Electron" token), so sign-in pages treat it as Chrome. */
export function chromeUserAgent(): string {
  const major = (process.versions.chrome || '140').split('.')[0]
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

// TradingView needs none of camera / mic / location / notifications etc.; only these are granted
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

/** Sign-in popups may only open further sign-in pages and navigate within sign-in hosts; anything else goes to the browser. */
function lockDownPopup(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (!isAuthHost(url)) openExternalSafe(url)
    return isAuthHost(url) ? { action: 'allow' } : { action: 'deny' }
  })
  wc.on('will-navigate', (e, url) => {
    if (!isAuthHost(url)) {
      e.preventDefault()
      openExternalSafe(url)
    }
  })
  wc.on('did-create-window', (child) => lockDownPopup(child.webContents))
}

export interface TvManager extends TvCore {
  dispose(): void
}

export function createTvManager(win: BrowserWindow, emit: (s: TvState) => void): TvManager {
  const ses = session.fromPartition(TV_PARTITION)
  ses.setUserAgent(chromeUserAgent())
  ses.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED_PERMISSIONS.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  let view: WebContentsView | null = null
  let core: TvCore

  const emitState = async (): Promise<void> => {
    if (!view || view.webContents.isDestroyed()) return
    const url = view.webContents.getURL()
    let fromUrl: string | null = null
    try {
      fromUrl = new URL(url).searchParams.get('symbol')
    } catch {
      fromUrl = null
    }
    const symbol = core.symbol() ?? fromUrl                     // after an in-place switch the address still names the old one
    const cookies = await ses.cookies.get({ domain: 'tradingview.com', name: 'sessionid' }).catch(() => [])
    const signedIn = cookies.length > 0
    core.sessionChanged(signedIn)
    emit({ url, symbol, loading: view.webContents.isLoading(), signedIn })
  }

  const ensure = (): WebContentsView => {
    if (view) return view
    view = new WebContentsView({
      webPreferences: { partition: TV_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false }
    })
    view.setBackgroundColor('#05060a')
    const wc = view.webContents
    wc.setWindowOpenHandler(({ url }) =>
      core.popup(url) === 'allow'
        ? {
            action: 'allow',
            overrideBrowserWindowOptions: {
              parent: win, width: 520, height: 720, autoHideMenuBar: true,
              webPreferences: { partition: TV_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false }
            }
          }
        : { action: 'deny' }
    )
    wc.on('did-create-window', (child) => lockDownPopup(child.webContents))
    wc.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page'] as const) {
      wc.on(ev as 'did-stop-loading', () => void emitState())
    }
    return view
  }

  const port: TvViewPort = {
    attach: () => win.contentView.addChildView(ensure()),
    detach: () => {
      if (view) win.contentView.removeChildView(view)
    },
    setBounds: (b) => ensure().setBounds(b),
    load: (url) => {
      ensure().webContents.loadURL(url).catch(() => undefined)   // TradingView's own page shows load errors
    },
    currentUrl: () => (view && !view.webContents.isDestroyed() ? view.webContents.getURL() : ''),
    back: () => {
      const h = view?.webContents.navigationHistory
      if (h?.canGoBack()) h.goBack()
    },
    reload: () => view?.webContents.reload(),
    openExternal: (url) => openExternalSafe(url),
    switchInPage: async (symbol, interval) => {
      const wc = view?.webContents
      if (!wc || wc.isDestroyed() || wc.isLoading()) return false
      const ok = (await wc.executeJavaScript(switchScript(symbol, interval)).catch(() => false)) === true
      if (ok) void emitState()
      return ok
    }
  }
  core = createTvCore(port)

  const dispose = (): void => {
    if (view && !view.webContents.isDestroyed()) view.webContents.close()
    view = null
  }
  win.on('closed', dispose)
  return { ...core, dispose }
}
