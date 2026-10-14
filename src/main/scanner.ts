/** Runs the scanner script (scan.py in the scanner folder) and reads the newest CSVs it saved under scans/. */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile as nodeReadFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SCAN_DAYS_BACK } from '../shared/defaults'
import type { ScanResult, ScanRunOutcome } from '../shared/types'
import { marketOpenAt, newestScanFiles, parseExitsCsv, parseScanCsv, stampToNy } from './csv'
import { pythonCommand, SCAN_PREFIX, SCAN_SCRIPT, scansDir } from './paths'

/** Every outside effect, injectable for tests. Defaults: Node's spawn and fs, this machine's platform, paths.ts. */
export interface ScannerDeps {
  /** The folder that holds scan.py (required: see paths.ts scannerDir). */
  scannerDir: string
  spawn?: typeof nodeSpawn
  readDir?: (dir: string) => Promise<string[]>
  readFile?: (file: string) => Promise<string>
  /** Kills the scan and everything it started (default: `taskkill /PID <pid> /T /F` on Windows, SIGTERM elsewhere). */
  killTree?: (child: ChildProcess) => void
  platform?: NodeJS.Platform
  /** Does this file or folder exist (default: fs.existsSync)? */
  exists?: (path: string) => boolean
  /** A file's last-modified time in ms (default: fs.stat); tells a same-minute rerun's file from the old one. */
  mtime?: (file: string) => Promise<number>
  python?: string
  timeoutMs?: number
}

export interface ScannerService {
  latest(): Promise<ScanResult | null>
  run(onLine: (line: string) => void): Promise<ScanRunOutcome>
  cancel(): void
  /** Cancels a running scan and waits (up to a few seconds) for it to stop: call before the app quits. */
  stopAll(): Promise<void>
}

const TAIL_LINES = 40
const TIMEOUT_MS = 15 * 60 * 1000
const KILL_BACKSTOP_MS = 5000   // if the process ignores the kill, give up waiting and free the scanner
const WINDOWS_COMMAND_NOT_FOUND = 9009 // also what the Microsoft Store "python" stub exits with
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

type StopReason = 'cancelled' | 'timeout' | null
interface Prior { stamp: string; mtime: number | null }
interface RunState {
  readonly child: ChildProcess
  readonly stop: StopReason
  /** Ends the run now (used when the process will not exit after a kill). */
  readonly force?: (reason: string) => void
  readonly done?: Promise<void>
}

function errCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function pythonMissing(python: string): string {
  return `Python was not found (tried '${python}'). Install Python 3, or set MC_PYTHON to its full path.`
}

/** The plain "set it up" sentence the Signals tab shows when there is no scanner folder (or no scan.py in it). */
export function folderMissing(dir: string): string {
  return `No scanner found: ${dir} has no ${SCAN_SCRIPT}. Set MC_SCANNER_DIR to the folder that holds your ${SCAN_SCRIPT} ` +
    `(start from the example-scanner folder in the repo), then open the app again.`
}

function failed(error: string, tail: string[] = [], code: number | null = null): ScanRunOutcome {
  return { ok: false, code, tail, result: null, error }
}

/** Splits a text stream into clean lines (ANSI colors stripped, blank lines dropped); flush() emits a last unfinished line. */
function lineSplitter(emit: (line: string) => void): { push(chunk: string): void; flush(): void } {
  let rest = ''
  const out = (raw: string): void => {
    const line = raw.replace(ANSI, '').trimEnd()
    if (line.trim() !== '') emit(line)
  }
  return {
    push(chunk) {
      const parts = (rest + chunk).split(/\r\n|\r|\n/)
      rest = parts.pop() ?? ''
      parts.forEach(out)
    },
    flush() {
      out(rest)
      rest = ''
    }
  }
}

interface StopInfo { python: string; stop: StopReason; code: number | null; signal: NodeJS.Signals | null; timeoutMs: number }

/** Why a finished scan process failed, in plain words, or null when it exited cleanly on its own. */
function stopProblem({ python, stop, code, signal, timeoutMs }: StopInfo): string | null {
  if (stop === 'cancelled') return 'The scan was cancelled.'
  if (stop === 'timeout') return `The scan took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.`
  if (code === 0) return null
  if (code === WINDOWS_COMMAND_NOT_FOUND) return pythonMissing(python)
  return code === null ? `The scan was stopped (${signal ?? 'no exit code'}).` : `The scan stopped (exit code ${code}).`
}

function defaultKillTree(spawnFn: typeof nodeSpawn, platform: NodeJS.Platform): (child: ChildProcess) => void {
  return (child) => {
    if (platform !== 'win32' || child.pid === undefined) {
      child.kill('SIGTERM')
      return
    }
    // full path: a taskkill.exe dropped in the working folder must never run instead
    const taskkill = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    const killer = spawnFn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.on('error', () => child.kill()) // taskkill missing: at least stop Python itself
  }
}

export function createScannerService(deps: ScannerDeps): ScannerService {
  const spawnFn = deps.spawn ?? nodeSpawn
  const readDir = deps.readDir ?? ((dir: string) => readdir(dir))
  const readFile = deps.readFile ?? ((file: string) => nodeReadFile(file, 'utf8'))
  const killTree = deps.killTree ?? defaultKillTree(spawnFn, deps.platform ?? process.platform)
  const exists = deps.exists ?? existsSync
  const mtime = deps.mtime ?? (async (file: string) => (await stat(file)).mtimeMs)
  const dir = deps.scannerDir
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS
  let running: RunState | null = null

  async function listScans(folder: string): Promise<string[]> {
    try {
      return await readDir(folder)
    } catch (err) {
      if (errCode(err) === 'ENOENT' || errCode(err) === 'ENOTDIR') return []
      throw new Error(`Couldn't read the scans folder ${folder}: ${errMessage(err)}`)
    }
  }

  async function latest(): Promise<ScanResult | null> {
    if (!exists(dir)) throw new Error(folderMissing(dir))
    const folder = scansDir(dir)
    const pick = newestScanFiles(await listScans(folder))
    if (pick.scan === null || pick.stamp === null) return null
    const file = join(folder, pick.scan)
    const scan = parseScanCsv(await readFile(file))
    const exits = pick.exits === null ? { exits: [], skipped: 0 } : parseExitsCsv(await readFile(join(folder, pick.exits)))
    const scannedAtNy = stampToNy(pick.stamp)
    const warnings = [...scan.warnings, ...(exits.skipped ? [`${exits.skipped} exit row${exits.skipped > 1 ? 's' : ''} could not be read.`] : [])]
    return {
      file, scannedAtNy,
      signals: scan.signals, exits: exits.exits, skippedRows: scan.skipped + exits.skipped,
      version: scan.version, marketOpenAtScan: marketOpenAt(scannedAtNy), exitsSaved: pick.exits !== null, warnings
    }
  }

  function kill(stop: Exclude<StopReason, null>): void {
    if (!running) return
    running = { ...running, stop }
    killTree(running.child)
    const backstop = setTimeout(() => running?.force?.('The scan did not stop when asked; it was let go.'), KILL_BACKSTOP_MS)
    backstop.unref?.()
  }

  function cancel(): void {
    kill('cancelled')
  }

  async function stopAll(): Promise<void> {
    if (!running) return
    const wait = running.done ?? Promise.resolve()
    kill('cancelled')
    await Promise.race([wait, new Promise((r) => setTimeout(r, KILL_BACKSTOP_MS))])
  }

  function run(onLine: (line: string) => void): Promise<ScanRunOutcome> {
    if (running) return Promise.resolve(failed('A scan is already running.'))
    if (!exists(join(dir, SCAN_SCRIPT))) return Promise.resolve(failed(folderMissing(dir)))
    const python = deps.python ?? pythonCommand()
    let child: ChildProcess
    try {
      child = spawnFn(python, [SCAN_SCRIPT, String(SCAN_DAYS_BACK)], {
        cwd: dir,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (err) {
      return Promise.resolve(failed(`Couldn't start the scan: ${errMessage(err)}`))
    }
    // the newest results file before this run: success needs a newer one (an exit 0 that saved nothing is not fresh data)
    const before = priorScan()
    running = { child, stop: null }
    return watch(child, python, onLine, before)
  }

  /** The newest scan file's stamp and modified time right now (null when there is none). */
  async function priorScan(): Promise<Prior | null> {
    try {
      const pick = newestScanFiles(await listScans(scansDir(dir)))
      if (pick.scan === null || pick.stamp === null) return null
      return { stamp: pick.stamp, mtime: await mtime(join(scansDir(dir), pick.scan)).catch(() => null) }
    } catch {
      return null
    }
  }

  /** A newer stamp, or the same minute's file rewritten (rerun within a minute: the name repeats, the modified time moves). */
  async function isFresh(result: ScanResult, prior: Prior | null): Promise<boolean> {
    if (prior === null) return true
    const prev = stampToNy(prior.stamp)
    if (result.scannedAtNy > prev) return true
    if (result.scannedAtNy < prev || prior.mtime === null) return false
    const now = await mtime(result.file).catch(() => null)
    return now !== null && now > prior.mtime
  }

  function watch(child: ChildProcess, python: string, onLine: (line: string) => void, before: Promise<Prior | null>): Promise<ScanRunOutcome> {
    let markDone: () => void = () => undefined
    const done = new Promise<void>((r) => { markDone = r })
    return new Promise((resolve) => {
      let tail: string[] = []
      let settled = false
      const emit = (line: string): void => {
        tail = [...tail.slice(-(TAIL_LINES - 1)), line]
        try {
          onLine(line)
        } catch (err) {
          console.error(`[scanner] progress listener failed: ${errMessage(err)}`) // the scan itself keeps going
        }
      }
      const outLines = lineSplitter(emit)
      const errLines = lineSplitter(emit)
      const timer = setTimeout(() => kill('timeout'), timeoutMs)
      const finish = (outcome: ScanRunOutcome): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        running = null
        markDone()
        resolve(outcome)
      }
      if (running) {
        running = { ...running, done, force: (reason) => finish({ ...failed(reason, tail), cancelled: running?.stop === 'cancelled' }) }
      }
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => outLines.push(chunk))
      child.stderr?.on('data', (chunk: string) => errLines.push(chunk))
      child.on('error', (err) => {
        finish(errCode(err) === 'ENOENT' ? failed(pythonMissing(python), tail) : failed(`Couldn't run the scan: ${errMessage(err)}`, tail))
      })
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return
        outLines.flush()
        errLines.flush()
        const stop = running?.stop ?? null
        const problem = stopProblem({ python, stop, code, signal, timeoutMs })
        if (problem !== null) {
          finish({ ...failed(problem, tail, code), cancelled: stop === 'cancelled' })
          return
        }
        Promise.all([latest(), before]).then(
          async ([result, prior]) => {
            if (!result) return finish(failed(`The scan finished but saved no ${SCAN_PREFIX}_*.csv in ${scansDir(dir)}.`, tail, code))
            if (!(await isFresh(result, prior))) {
              return finish(failed(`The scan finished but saved no new results (the newest file is still from ${result.scannedAtNy} New York time).`, tail, code))
            }
            finish({ ok: true, code, tail, result, error: null })
          },
          (err) => finish(failed(`The scan finished but its file couldn't be read: ${errMessage(err)}`, tail, code))
        )
      })
    })
  }

  return { latest, run, cancel, stopAll }
}
