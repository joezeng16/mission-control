/** Launches the built app (npm run build first) against a fresh copy of the example scanner, runs a scan and clicks
 *  through both tabs. Screenshots go to e2e/shots/ (git-ignored). Needs Python 3 and an internet connection
 *  (TradingView and Yahoo). Close any open Options Desk first: the app allows one copy at a time. */
import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = join(__dirname, 'shots')
const ROOT = join(__dirname, '..')

test('the app starts, runs the example scanner and every tab renders', async () => {
  mkdirSync(SHOTS, { recursive: true })
  const scannerDir = mkdtempSync(join(tmpdir(), 'mc-scanner-'))
  copyFileSync(join(ROOT, 'example-scanner', 'scan.py'), join(scannerDir, 'scan.py'))
  const env: Record<string, string> = { ...(process.env as Record<string, string>), MC_SCANNER_DIR: scannerDir }
  delete env.ELECTRON_RUN_AS_NODE   // set in some editor terminals; Electron would start as plain Node

  const app = await electron.launch({ args: [join(ROOT, 'out', 'main', 'index.js')], env })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  const shot = async (name: string): Promise<void> => {
    // the app page only: the TradingView view is a separate web view, captured on its own below
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      return (await w.capturePage()).toPNG().toString('base64')
    })
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'))
  }
  // the TradingView view itself (a separate web view drawn over the window)
  const tvView = (): Promise<{ url: string; bounds: Electron.Rectangle; png: string } | null> =>
    app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const views = w.contentView.children as unknown as { webContents?: Electron.WebContents; getBounds(): Electron.Rectangle }[]
      const v = views.find((x) => x.webContents && x.webContents.getURL().includes('tradingview.com'))
      if (!v || !v.webContents) return null
      return { url: v.webContents.getURL(), bounds: v.getBounds(), png: (await v.webContents.capturePage()).toPNG().toString('base64') }
    })

  // two tabs: Signals (scanner + chart) and Calculator
  const nav = win.getByRole('navigation', { name: 'Sections' })
  await expect(nav.getByRole('listitem')).toHaveText([/Signals/, /Calculator/])
  const signals = win.getByRole('region', { name: 'Signals' })
  await expect(signals.getByRole('heading', { name: 'Signals' })).toBeVisible()

  // a fresh scanner folder has no scan yet; Run scan runs the example scanner and fills the table
  await expect(signals.getByText('No scan yet. Press Run scan to run your scanner.')).toBeVisible({ timeout: 15_000 })
  await signals.getByRole('button', { name: 'Run scan' }).click()
  await expect(signals.getByRole('button', { name: 'Calculate NVDA' })).toBeVisible({ timeout: 60_000 })
  await expect(signals.getByText('Example scanner 1.0')).toBeVisible()
  await expect(signals.getByRole('button', { name: /^Calculate / })).toHaveCount(6)
  await expect(signals.getByRole('region', { name: 'Exits' })).toContainText('JPM')
  await win.waitForTimeout(6000)                      // TradingView's first load
  await shot('01-signals')
  const chart = await tvView()
  expect(chart, 'TradingView view attached on the Signals tab').not.toBeNull()
  if (chart) {
    writeFileSync(join(SHOTS, '02-tradingview-view.png'), Buffer.from(chart.png, 'base64'))
    writeFileSync(join(SHOTS, 'tv.txt'), `${chart.url}\n${JSON.stringify(chart.bounds)}`)
  }

  // signed out: the rail's button opens TradingView's sign-in page in the same chart pane
  const signIn = win.getByRole('button', { name: /Sign in to TradingView/ })
  if (await signIn.isVisible()) {
    await signIn.click()
    await win.waitForTimeout(6000)
    const page = await tvView()
    expect(page?.url ?? '', 'sign-in page in the pane').toContain('tradingview.com')
    if (page) writeFileSync(join(SHOTS, '03-tv-signin.png'), Buffer.from(page.png, 'base64'))
  }

  // a row's Calculate opens that trade in the calculator (live Yahoo chain)
  await signals.getByRole('button', { name: 'Calculate NVDA' }).click()
  const calculator = win.getByRole('region', { name: 'Calculator' })
  await expect(calculator).toBeVisible()
  await win.waitForTimeout(8000)
  await expect(calculator.getByText('Yahoo · about 15 min delayed')).toBeVisible({ timeout: 20_000 })
  await shot('04-calculator')

  writeFileSync(join(SHOTS, 'console-errors.txt'), errors.join('\n'))
  await app.close()
  expect(errors, 'no errors on the app page').toEqual([])
})
