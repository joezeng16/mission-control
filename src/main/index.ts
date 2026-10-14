import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { log } from './logger'
import { openExternalSafe } from './safe-url'

/** The app's own page: the dev server in development, the built index.html when packaged. */
export function isAppUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) return url.startsWith(devUrl)
  return url.split(/[?#]/)[0] === pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    backgroundColor: '#05060a',
    title: 'Options Desk',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#05060a', symbolColor: '#a1a8b8', height: 36 },
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  // the app page never navigates away (links open in the browser); zoom stays at 100% so the TradingView view lines up
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault()
      openExternalSafe(url)
    }
  })
  // a blank window must explain itself in the log
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log('error', `page failed to load (${code} ${desc}) ${url}`))
  win.webContents.on('preload-error', (_e, path, err) => log('error', `preload failed: ${path}`, err))
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') log('error', `page: ${e.message}`)
  })
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.control && ['+', '=', '-', '0'].includes(input.key)) e.preventDefault()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/** The app id (Windows taskbar grouping) and its own settings folder: it holds this app's TradingView session, logs and
 *  single-instance lock. */
export const APP_ID = 'io.github.optionsdesk.app'
const USER_DATA_DIR = 'Options Desk'
app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIR))

// one Options Desk at a time: a second copy would fight over the TradingView sign-in and the scan files
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  process.on('uncaughtException', (err) => log('error', 'uncaught exception', err))
  process.on('unhandledRejection', (err) => log('error', 'unhandled rejection', err))
  app.on('render-process-gone', (_e, wc, details) => log('error', `page crashed (${details.reason}) ${wc.getURL()}`))
  app.on('child-process-gone', (_e, details) => log('warn', `helper process gone: ${details.type} ${details.reason}`))
  app.whenReady().then(() => {
    electronApp.setAppUserModelId(APP_ID)
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
    const win = createWindow()
    app.on('second-instance', () => {
      if (win.isMinimized()) win.restore()
      win.focus()
    })
    registerIpc(win, isAppUrl)
    log('info', `started v${app.getVersion()}`)
  })
}

app.on('window-all-closed', () => {
  app.quit()
})
