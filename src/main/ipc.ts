/** IPC handlers behind window.mc (see src/preload/index.ts for the channel names). Every input from the renderer is
 *  checked here, and only the app's own page may call them. */
import { app, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { Bounds, TvInterval } from '../shared/types'
import { log } from './logger'
import { createMarketService } from './market'
import { scannerDir } from './paths'
import { createScannerService } from './scanner'
import { createTvManager } from './tv'

const INTERVALS: readonly TvInterval[] = ['D', '240', '60', '30']
const TICKER = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function ticker(v: unknown): string {
  if (typeof v === 'string' && TICKER.test(v.trim())) return v.trim().toUpperCase()
  throw new Error(`"${String(v)}" is not a ticker`)
}

function bounds(v: unknown): Bounds | null {
  if (v === null) return null
  const b = v as Partial<Bounds>
  const ok = [b?.x, b?.y, b?.width, b?.height].every((n) => typeof n === 'number' && Number.isFinite(n))
  return ok ? (b as Bounds) : null
}

export function registerIpc(win: BrowserWindow, isAppUrl: (url: string) => boolean): void {
  const dir = scannerDir(app.isPackaged)
  log('info', `scanner folder: ${dir}`)
  const scanner = createScannerService({ scannerDir: dir })
  const market = createMarketService()
  const tv = createTvManager(win, (s) => {
    if (!win.isDestroyed()) win.webContents.send('tv:state', s)
  })

  // only the app's own page may call these (never the TradingView view or a page it opened)
  const fromApp = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    !win.isDestroyed() && e.sender === win.webContents && isAppUrl(e.senderFrame?.url ?? '')

  /** ipcMain.handle with the sender check; failures are logged, then reach the page as the same plain message. */
  function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, async (e, ...args: unknown[]) => {
      if (!fromApp(e)) {
        log('warn', `${channel} refused: sent from ${e.senderFrame?.url ?? 'an unknown page'}`)
        throw new Error('Not allowed')
      }
      try {
        return await fn(...args)
      } catch (err) {
        log('warn', `${channel} failed`, err)
        throw err
      }
    })
  }
  function on(channel: string, fn: (...args: unknown[]) => void): void {
    ipcMain.on(channel, (e, ...args: unknown[]) => {
      if (fromApp(e)) fn(...args)
    })
  }

  handle('scanner:latest', () => scanner.latest())
  handle('scanner:run', async () => {
    const out = await scanner.run((line) => {
      if (!win.isDestroyed()) win.webContents.send('scanner:progress', { line })
    })
    log(out.ok ? 'info' : 'warn', `scan ${out.ok ? 'finished' : out.cancelled ? 'cancelled' : `failed (code ${out.code}): ${out.error ?? ''}`}`)
    return out
  })
  handle('scanner:cancel', () => scanner.cancel())

  handle('market:quote', (t) => market.quote(ticker(t)))
  handle('market:expirations', (t) => market.expirations(ticker(t)))
  handle('market:chain', (t, expiry) => {
    if (typeof expiry !== 'string' || !DATE.test(expiry)) throw new Error('Pick an expiration date')
    return market.chain(ticker(t), expiry)
  })

  on('tv:bounds', (b) => tv.setBounds(bounds(b)))
  on('tv:show', (t, interval) => {
    if (typeof t !== 'string' || !(INTERVALS as readonly unknown[]).includes(interval)) return
    tv.show(t, interval as TvInterval)
  })
  on('tv:back', () => tv.back())
  on('tv:reload', () => tv.reload())
  on('tv:external', () => tv.openExternal())
  on('tv:signin', () => tv.signIn())

  // a scan still running when the window closes must not keep going in the background: stop it, then quit
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    void scanner.stopAll().finally(() => app.quit())
  })
}
