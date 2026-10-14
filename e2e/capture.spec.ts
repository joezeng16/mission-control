/** Regenerates the README images in docs/images/: `npm run capture` (needs Python 3 with Pillow: pip install pillow).
 *
 *  Launches the built app in a 1600 x 1000 window against a fresh copy of the example scanner (fictional signals), runs
 *  a scan and records raw frames in e2e/capture-raw/ (git-ignored). The TradingView chart is a separate web view drawn
 *  over the window, so every frame is two images: the window and the view, with the view's bounds.
 *  scripts/build_images.py then composites them into hero.png, signals.png, calculator.png and demo.gif.
 *
 *  TradingView must be signed out in this app (the run stops otherwise), so no account ever shows up in the images. The
 *  run switches that signed-out TradingView session to TradingView's dark theme and hides its watchlist panel.
 *  The example scanner's prices are made up, so on the calculator the run picks strikes near the market from the live
 *  chain (about 30% and 10% odds, the app's 3/3 defaults) instead of the scanner's far-away ones.
 *  Close any open Options Desk first: the app allows one copy at a time. */
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const RAW = join(__dirname, 'capture-raw')
const OUT = join(ROOT, 'docs', 'images')
const WIDTH = 1600
const HEIGHT = 1000
/** Device pixels per window pixel. 2 keeps text sharp after the images are scaled down to 1600 / 1200 wide. */
const SCALE = Number(process.env.OD_CAPTURE_SCALE ?? '2')

interface Rect { x: number; y: number; width: number; height: number }
interface Frame {
  window: string
  view: { file: string; bounds: Rect } | null
  /** How long the frame shows in the GIF. */
  ms: number
  /** The pointer drawn on the frame (window pixels), null = none. */
  cursor: [number, number] | null
  click: boolean
}
interface Still extends Frame { crop: Rect | null }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** The window and, when it is attached, the TradingView view, as PNGs. */
async function grab(app: ElectronApplication): Promise<{ win: string; view: { png: string; bounds: Rect } | null }> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const views = w.contentView.children as unknown as { webContents?: Electron.WebContents; getBounds(): Electron.Rectangle }[]
    const v = views.find((x) => x.webContents && !x.webContents.isDestroyed() && x.webContents.getURL().includes('tradingview.com'))
    const [wi, vi] = await Promise.all([w.capturePage(), v?.webContents ? v.webContents.capturePage() : Promise.resolve(null)])
    const view = v && vi && !vi.isEmpty() ? { png: vi.toPNG().toString('base64'), bounds: v.getBounds() } : null
    return { win: wi.toPNG().toString('base64'), view }
  })
}

/** Runs in the TradingView view: its title, whether it is loading, and whether the dark theme and the watchlist panel are on. */
async function tvState(app: ElectronApplication): Promise<{ title: string; loading: boolean; dark: boolean; panel: boolean } | null> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    const views = w.contentView.children as unknown as { webContents?: Electron.WebContents }[]
    const wc = views.find((x) => x.webContents && !x.webContents.isDestroyed() && x.webContents.getURL().includes('tradingview.com'))?.webContents
    if (!wc || wc.isLoading()) return wc ? { title: wc.getTitle(), loading: true, dark: false, panel: false } : null
    const page = await wc
      .executeJavaScript(
        `({ dark: document.documentElement.classList.contains('theme-dark'),
            panel: document.querySelector('[data-name=base]')?.getAttribute('aria-pressed') === 'true' })`
      )
      .catch(() => ({ dark: false, panel: false }))
    return { title: wc.getTitle(), loading: false, ...page }
  })
}

/** TradingView's own settings in this app's (signed-out) session: dark theme on, watchlist panel closed. */
async function styleTradingView(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }) => {
    const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    const w = BrowserWindow.getAllWindows()[0]
    const views = w.contentView.children as unknown as { webContents?: Electron.WebContents }[]
    const wc = views.find((x) => x.webContents && x.webContents.getURL().includes('tradingview.com'))?.webContents
    if (!wc) return
    const dark = await wc.executeJavaScript(`document.documentElement.classList.contains('theme-dark')`)
    if (!dark) {
      // the menu button is the first button in TradingView's header; its "Dark theme" row toggles the theme
      await wc.executeJavaScript(`[...document.querySelectorAll('button')].find((b) => b.offsetParent)?.click()`)
      await pause(1200)
      await wc.executeJavaScript(`(() => {
        const leaf = [...document.querySelectorAll('span, div')].find((e) => e.offsetParent && e.children.length === 0 && e.textContent.trim() === 'Dark theme')
        if (leaf) (leaf.closest('[role], button, label, a') || leaf.parentElement).click()
      })()`)
      await pause(1200)
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await pause(600)
    }
    await wc.executeJavaScript(`(() => {
      const b = document.querySelector('[data-name=base]')
      if (b && b.getAttribute('aria-pressed') === 'true') b.click()
    })()`)
    await pause(1500)
  })
}

/** Waits until the chart shows `symbol` (TradingView's title starts with it) and has finished loading. */
async function chartShows(app: ElectronApplication, symbol: string): Promise<boolean> {
  const s = await tvState(app)
  return !!s && !s.loading && s.title.startsWith(`${symbol} `)
}

/** Records frames for the GIF. Pointer moves reuse the last image (only the drawn pointer moves), so the real mouse
 *  never lingers on the way and no tooltip pops up mid-move. */
class Recorder {
  readonly frames: Frame[] = []
  private cursor: [number, number] | null = null
  private n = 0

  constructor(private readonly app: ElectronApplication, private readonly page: Page) {}

  async snap(ms: number, click = false): Promise<Frame> {
    const g = await grab(this.app)
    const id = `gif-${String(this.n++).padStart(3, '0')}`
    writeFileSync(join(RAW, `${id}-w.png`), Buffer.from(g.win, 'base64'))
    let view: Frame['view'] = null
    if (g.view) {
      writeFileSync(join(RAW, `${id}-v.png`), Buffer.from(g.view.png, 'base64'))
      view = { file: `${id}-v.png`, bounds: g.view.bounds }
    }
    const frame: Frame = { window: `${id}-w.png`, view, ms, cursor: this.cursor, click }
    this.frames.push(frame)
    return frame
  }

  /** The drawn pointer glides to (x, y) over `steps` frames of `stepMs`. */
  glide(x: number, y: number, steps = 7, stepMs = 45): void {
    const last = this.frames[this.frames.length - 1]
    const [x0, y0] = this.cursor ?? [x, y + 120]
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps)
      this.cursor = [x0 + (x - x0) * t, y0 + (y - y0) * t]
      this.frames.push({ ...last, ms: stepMs, cursor: this.cursor, click: false })
    }
  }

  async click(target: Locator, dx = 0.5, dy = 0.5): Promise<void> {
    const box = await target.boundingBox()
    if (!box) throw new Error('click target not visible')
    const x = box.x + box.width * dx
    const y = box.y + box.height * dy
    this.glide(x, y)
    await this.page.mouse.click(x, y)
    await this.snap(110, true)
  }

  /** Keeps recording until `done` holds, then holds the last frame for `holdMs`. */
  async until(done: () => Promise<boolean>, holdMs: number, maxMs = 15_000): Promise<void> {
    const start = Date.now()
    while (!(await done())) {
      if (Date.now() - start > maxMs) throw new Error('timed out while recording')
      await this.snap(140)
    }
    await sleep(500)                               // the chart's last paint
    await this.snap(holdMs)
  }

  /** Drags a slider thumb from where it is to `toX` in `steps` real moves, one frame each. */
  async drag(thumb: Locator, toX: number, steps: number, stepMs: number): Promise<void> {
    const box = await thumb.boundingBox()
    if (!box) throw new Error('slider thumb not visible')
    const x0 = box.x + box.width / 2
    const y = box.y + box.height / 2
    this.glide(x0, y)
    await this.page.mouse.move(x0, y)
    await this.page.mouse.down()
    await this.snap(stepMs, true)
    for (let i = 1; i <= steps; i++) {
      const x = x0 + (toX - x0) * ease(i / steps)
      await this.page.mouse.move(x, y)
      this.cursor = [x, y]
      await sleep(30)
      await this.snap(stepMs)
    }
    await this.page.mouse.up()
  }
}

/** Saves one still for build_images.py. */
async function still(app: ElectronApplication, name: string, crop: Rect | null = null, cursor: [number, number] | null = null): Promise<Still> {
  const g = await grab(app)
  writeFileSync(join(RAW, `${name}-w.png`), Buffer.from(g.win, 'base64'))
  let view: Frame['view'] = null
  if (g.view) {
    writeFileSync(join(RAW, `${name}-v.png`), Buffer.from(g.view.png, 'base64'))
    view = { file: `${name}-v.png`, bounds: g.view.bounds }
  }
  return { window: `${name}-w.png`, view, ms: 0, cursor, click: false, crop }
}

/** Opens a strike dropdown and picks the strike whose "odds it's hit" is closest to `target` (and under `below`). */
async function pickStrike(win: Page, name: string, target: number, below: number | null = null): Promise<number> {
  await win.getByRole('combobox', { name }).click()
  const options = win.getByRole('option')
  await expect(options.first()).toBeVisible()
  const texts = await options.allTextContents()
  let best = -1
  let gap = Infinity
  let strike = NaN
  texts.forEach((t, i) => {
    const k = Number(/^\$([\d,.]+)/.exec(t)?.[1]?.replace(/,/g, ''))
    const odds = Number(/(\d+)% odds/.exec(t)?.[1])
    if (!Number.isFinite(k) || !Number.isFinite(odds) || (below != null && k >= below)) return
    if (Math.abs(odds - target) < gap) {
      gap = Math.abs(odds - target)
      best = i
      strike = k
    }
  })
  if (best < 0) throw new Error(`no strike with odds in the ${name} list`)
  await options.nth(best).click()
  await expect(options).toHaveCount(0)
  return strike
}

test('capture the README screenshots and demo GIF', async () => {
  test.setTimeout(300_000)
  rmSync(RAW, { recursive: true, force: true })
  mkdirSync(RAW, { recursive: true })
  const scannerDir = mkdtempSync(join(tmpdir(), 'od-scanner-'))
  copyFileSync(join(ROOT, 'example-scanner', 'scan.py'), join(scannerDir, 'scan.py'))
  const env: Record<string, string> = { ...(process.env as Record<string, string>), MC_SCANNER_DIR: scannerDir }
  delete env.ELECTRON_RUN_AS_NODE   // set in some editor terminals; Electron would start as plain Node

  const app = await electron.launch({
    args: [
      `--force-device-scale-factor=${SCALE}`,
      '--disable-features=CalculateNativeWinOcclusion',   // keep painting when another window covers it
      join(ROOT, 'out', 'main', 'index.js')
    ],
    env
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // the window frame rounds at some scales: nudge until the page is exactly WIDTH x HEIGHT
  let ask = { width: WIDTH, height: HEIGHT }
  for (let i = 0; i < 4; i++) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.setContentSize(size.width, size.height)
      w.setPosition(0, 0)
    }, ask)
    await win.waitForTimeout(400)
    const [w, h] = await win.evaluate(() => [window.innerWidth, window.innerHeight])
    if (w === WIDTH && h === HEIGHT) break
    ask = { width: ask.width + WIDTH - w, height: ask.height + HEIGHT - h }
  }
  expect(await win.evaluate(() => [window.innerWidth, window.innerHeight]), 'window size').toEqual([WIDTH, HEIGHT])

  // no account in the pictures: TradingView must be signed out in this app
  const signIn = win.getByRole('button', { name: /Sign in to TradingView/ })
  await expect(signIn, 'Sign out of TradingView in Options Desk before capturing: the images must not show an account.').toBeVisible({ timeout: 30_000 })

  // a scan of the example scanner
  const signals = win.getByRole('region', { name: 'Signals' })
  await signals.getByRole('button', { name: 'Run scan' }).click()
  await expect(signals.getByRole('button', { name: 'Calculate NVDA' })).toBeVisible({ timeout: 60_000 })
  const row = (ticker: string): Locator =>
    signals.locator('table tbody tr').filter({ has: win.getByText(ticker, { exact: true }) }).first()

  // the chart: NVDA (the first row), dark theme, watchlist closed
  await row('NVDA').click()
  await expect.poll(() => chartShows(app, 'NVDA'), { timeout: 60_000 }).toBe(true)
  await styleTradingView(app)
  const tv = await tvState(app)
  expect(tv?.dark, 'TradingView dark theme').toBe(true)
  expect(tv?.panel, 'TradingView watchlist closed').toBe(false)
  await win.mouse.move(WIDTH / 2, 12)                      // the title bar: nothing hovers there
  await win.waitForTimeout(2500)
  const hero = await still(app, 'hero')

  // the signal table up close, with the "Check chart" tooltip of a borderline signal open
  const amzn = row('AMZN')
  const amznName = amzn.getByText('AMZN', { exact: true })
  const nameBox = await amznName.boundingBox()
  if (!nameBox) throw new Error('AMZN row not visible')
  // past the eye icon, still on the cell (the tooltip's trigger), where the pointer covers no text
  const spot: [number, number] = [nameBox.x + nameBox.width + 34, nameBox.y + nameBox.height * 0.3]
  await win.mouse.move(spot[0], spot[1])
  await expect(win.getByRole('tooltip')).toBeVisible()
  await win.waitForTimeout(400)
  const table = await signals.locator('table').boundingBox()
  const filters = await signals.getByText('All', { exact: true }).boundingBox()
  const amznBox = await amzn.boundingBox()
  if (!table || !filters || !amznBox) throw new Error('signal table not visible')
  const top = filters.y - 14                               // from the level filter down to the AMZN row
  const crop: Rect = { x: table.x, y: top, width: table.width, height: amznBox.y + amznBox.height + 10 - top }
  const signalsShot = await still(app, 'signals', crop, spot)

  // the calculator on the NVDA row, with strikes near the market (the example's prices are made up)
  await win.mouse.move(WIDTH / 2, 12)
  await signals.getByRole('button', { name: 'Calculate NVDA' }).click()
  const calculator = win.getByRole('region', { name: 'Calculator' })
  await expect(calculator.getByText('Yahoo · about 15 min delayed')).toBeVisible({ timeout: 30_000 })
  const short = await pickStrike(win, 'Sell put', 30)
  await pickStrike(win, 'Buy put (wing)', 10, short)
  await win.mouse.move(WIDTH / 2, 12)
  await win.waitForTimeout(1500)
  const calcShot = await still(app, 'calculator')

  // the GIF: GOOGL on the chart, then three rows in turn (rows whose name cell has no tooltip), then the calculator
  // (the NVDA trade from above) and its date slider
  const nav = win.getByRole('navigation', { name: 'Sections' })
  await nav.getByRole('button', { name: /Signals/ }).click()
  await row('GOOGL').click()
  await expect.poll(() => chartShows(app, 'GOOGL'), { timeout: 30_000 }).toBe(true)
  await win.mouse.move(WIDTH / 2, 12)
  await win.waitForTimeout(1500)
  const rec = new Recorder(app, win)
  await rec.snap(900)
  for (const ticker of ['AAPL', 'KO', 'NVDA']) {
    await rec.click(row(ticker).getByText(ticker, { exact: true }), 0.5, 0.9)
    await rec.until(() => chartShows(app, ticker), 650)
  }
  await rec.click(nav.getByRole('button', { name: /Calculator/ }))
  await win.mouse.move(WIDTH * 0.6, 12)                   // off the rail, so its tooltip closes
  await rec.snap(140)
  await sleep(300)
  await rec.snap(450)
  const date = calculator.locator('[aria-label="Date"]')
  const track = await date.boundingBox()
  if (!track) throw new Error('date slider not visible')
  await rec.drag(date.getByRole('slider'), track.x + track.width * 0.86, 16, 85)
  await rec.snap(1300)

  writeFileSync(
    join(RAW, 'manifest.json'),
    JSON.stringify({ size: [WIDTH, HEIGHT], scale: SCALE, stills: { hero, signals: signalsShot, calculator: calcShot }, gif: rec.frames }, null, 2)
  )
  await app.close()
  rmSync(scannerDir, { recursive: true, force: true })

  // composite, crop, resize and compress into docs/images/
  const python = process.env.MC_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  execFileSync(python, [join(ROOT, 'scripts', 'build_images.py'), RAW, OUT], { stdio: 'inherit' })
})
