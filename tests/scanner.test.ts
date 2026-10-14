import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { resolveScannerDir } from '../src/main/paths'
import { createScannerService, type ScannerDeps } from '../src/main/scanner'

const FIXTURES = join(__dirname, 'fixtures')
const DIR = join('fake', 'scanner')
const SCANS = join(DIR, 'scans')

interface FakeChild extends EventEmitter {
  pid: number
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(pid = 4242): FakeChild {
  return Object.assign(new EventEmitter(), { pid, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) })
}

/** A spawn stand-in: every call records its arguments and returns the next fake child (scan runs) or a throwaway one (taskkill). */
function fakeSpawn(children: FakeChild[]) {
  const queue = [...children]
  return vi.fn((..._args: unknown[]) => queue.shift() ?? fakeChild(1))
}

const FIXTURE_FILES = ['signals_scan_2026-03-11_1005.csv', 'signals_exits_2026-03-11_1005.csv']

/** Each finished scan process "writes" newer files: the stamps move one minute per close, and reads map back to the fixtures. */
function deps(over: Partial<ScannerDeps> = {}): ScannerDeps {
  let closes = 0
  const spawn = over.spawn
    ? (((...args: Parameters<NonNullable<ScannerDeps['spawn']>>) => {
        const child = (over.spawn as (...a: unknown[]) => EventEmitter)(...args)
        child.once('close', () => { closes += 1 })
        return child
      }) as unknown as ScannerDeps['spawn'])
    : undefined
  const bump = (name: string): string =>
    name.replace(/_(\d{4}-\d{2}-\d{2})_(\d{4})\.csv$/, (_m, d: string, t: string) => `_${d}_${String(Number(t) + closes).padStart(4, '0')}.csv`)
  const fixtureFor = (name: string): string => FIXTURE_FILES.find((f) => f.slice(0, -9) === name.slice(0, -9)) ?? name
  return {
    scannerDir: DIR,
    python: 'python',
    platform: 'win32',
    exists: () => true,
    mtime: vi.fn(async () => 1000),
    readDir: vi.fn(async () => FIXTURE_FILES.map(bump)),
    readFile: vi.fn(async (file: string) => readFileSync(join(FIXTURES, fixtureFor(file.slice(SCANS.length + 1))), 'utf8')),
    ...over,
    ...(spawn ? { spawn } : {})
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('scanner folder', () => {
  it('MC_SCANNER_DIR wins; development uses the repo example; the installed app uses the home folder', () => {
    const mainDir = join('repo', 'out', 'main')
    const home = join('home', 'someone')
    expect(resolveScannerDir({ env: join('my', 'scanner'), packaged: true, mainDir, home })).toBe(join('my', 'scanner'))
    expect(resolveScannerDir({ env: null, packaged: false, mainDir, home })).toBe(join('repo', 'example-scanner'))
    expect(resolveScannerDir({ env: null, packaged: true, mainDir, home })).toBe(join(home, 'OptionsDesk', 'scanner'))
  })
})

describe('scanner.latest', () => {
  it('reads the newest scan and its exits', async () => {
    const svc = createScannerService(deps())
    const res = await svc.latest()
    expect(res).toMatchObject({
      file: join(SCANS, 'signals_scan_2026-03-11_1005.csv'), scannedAtNy: '2026-03-11 10:05', skippedRows: 0,
      version: 'Example scanner 1.0', marketOpenAtScan: true, exitsSaved: true, warnings: []
    })
    expect(res?.signals).toHaveLength(4)
    expect(res?.exits).toHaveLength(5)
  })

  it('latest returns null when no files', async () => {
    const empty = createScannerService(deps({ readDir: vi.fn(async () => ['notes.txt']) }))
    expect(await empty.latest()).toBeNull()
    const missing = createScannerService(deps({
      readDir: vi.fn(async () => { throw Object.assign(new Error('no dir'), { code: 'ENOENT' }) })
    }))
    expect(await missing.latest()).toBeNull()
  })

  it('a scan without its exits file still loads, marked as no exits saved', async () => {
    const svc = createScannerService(deps({ readDir: vi.fn(async () => [FIXTURE_FILES[0]]) }))
    expect(await svc.latest()).toMatchObject({ exits: [], exitsSaved: false })
  })
})

describe('scanner.run', () => {
  it('runs python with scan.py and the days back, streams clean lines and returns the latest scan', async () => {
    const child = fakeChild()
    const spawn = fakeSpawn([child])
    const svc = createScannerService(deps({ spawn: spawn as unknown as ScannerDeps['spawn'] }))
    const lines: string[] = []
    const done = svc.run((l) => lines.push(l))
    expect(spawn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = spawn.mock.calls[0] as [string, string[], { cwd: string; env: Record<string, string>; windowsHide: boolean }]
    expect(cmd).toBe('python')
    expect(args).toEqual(['scan.py', '5'])
    expect(opts).toMatchObject({ cwd: DIR, windowsHide: true })
    expect(opts.env.PYTHONIOENCODING).toBe('utf-8')
    child.stdout.write('Checking 8 tickers\r\n\u001b[32mdone\u001b[0m in 2s\n\n   \n')
    child.stderr.write('warning: slow\n')
    child.stdout.write('Saved: x.csv')
    await tick()
    child.emit('close', 0, null)
    const out = await done
    expect(lines).toEqual(['Checking 8 tickers', 'done in 2s', 'warning: slow', 'Saved: x.csv'])
    expect(out).toMatchObject({ ok: true, code: 0, error: null })
    expect(out.tail).toEqual(lines)
    expect(out.result?.signals).toHaveLength(4)
  })

  it('rejects a second run while one is running', async () => {
    const child = fakeChild()
    const next = fakeChild(8)
    const spawn = fakeSpawn([child, next])
    const svc = createScannerService(deps({ spawn: spawn as unknown as ScannerDeps['spawn'] }))
    const first = svc.run(() => {})
    const second = await svc.run(() => {})
    expect(second).toEqual({ ok: false, code: null, tail: [], result: null, error: 'A scan is already running.' })
    expect(spawn).toHaveBeenCalledTimes(1)
    child.emit('close', 0, null)
    expect((await first).ok).toBe(true)
    const again = svc.run(() => {}) // allowed again once the first finished
    expect(spawn).toHaveBeenCalledTimes(2)
    next.emit('close', 0, null)
    expect((await again).ok).toBe(true)
  })

  it('reports a missing python', async () => {
    const child = fakeChild()
    const next = fakeChild(9)
    const spawn = fakeSpawn([child, next])
    const svc = createScannerService(deps({ python: 'python', spawn: spawn as unknown as ScannerDeps['spawn'] }))
    const done = svc.run(() => {})
    child.emit('error', Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }))
    child.emit('close', -2, null)
    expect(await done).toEqual({
      ok: false, code: null, tail: [], result: null,
      error: "Python was not found (tried 'python'). Install Python 3, or set MC_PYTHON to its full path."
    })
    const again = svc.run(() => {}) // the failed run no longer blocks
    expect(spawn).toHaveBeenCalledTimes(2)
    next.emit('close', 0, null)
    expect((await again).ok).toBe(true)
    const custom = fakeChild()
    const pyPath = join('opt', 'py', 'python3')
    const svc2 = createScannerService(deps({ python: pyPath, spawn: fakeSpawn([custom]) as unknown as ScannerDeps['spawn'] }))
    const done2 = svc2.run(() => {})
    custom.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    expect((await done2).error).toBe(`Python was not found (tried '${pyPath}'). Install Python 3, or set MC_PYTHON to its full path.`)

    const stub = fakeChild() // the Microsoft Store "python" stub starts, then exits 9009
    const svc3 = createScannerService(deps({ spawn: fakeSpawn([stub]) as unknown as ScannerDeps['spawn'] }))
    const done3 = svc3.run(() => {})
    stub.emit('close', 9009, null)
    expect((await done3).error).toBe("Python was not found (tried 'python'). Install Python 3, or set MC_PYTHON to its full path.")
  })

  it('reports a non-zero exit with the output tail', async () => {
    const child = fakeChild()
    const svc = createScannerService(deps({ spawn: fakeSpawn([child]) as unknown as ScannerDeps['spawn'] }))
    const done = svc.run(() => {})
    child.stdout.write(Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join('\n') + '\nTraceback: boom\n')
    await tick()
    child.emit('close', 1, null)
    const out = await done
    expect(out).toMatchObject({ ok: false, code: 1, result: null, error: 'The scan stopped (exit code 1).' })
    expect(out.tail).toHaveLength(40)
    expect(out.tail[0]).toBe('line 7')
    expect(out.tail[39]).toBe('Traceback: boom')
  })

  it('cancel kills the process tree', async () => {
    const child = fakeChild(1234)
    const spawn = fakeSpawn([child])
    const svc = createScannerService(deps({ spawn: spawn as unknown as ScannerDeps['spawn'] }))
    const done = svc.run(() => {})
    svc.cancel()
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[1][0]).toMatch(/System32.taskkill\.exe$/i)
    expect(spawn.mock.calls[1][1]).toEqual(['/PID', '1234', '/T', '/F'])
    child.emit('close', 1, null)
    expect(await done).toMatchObject({ ok: false, result: null, error: 'The scan was cancelled.', cancelled: true })
    svc.cancel() // nothing running: no-op
    expect(spawn).toHaveBeenCalledTimes(2)

    const posix = fakeChild(99)
    const svc2 = createScannerService(deps({ platform: 'linux', spawn: fakeSpawn([posix]) as unknown as ScannerDeps['spawn'] }))
    const done2 = svc2.run(() => {})
    svc2.cancel()
    expect(posix.kill).toHaveBeenCalledWith('SIGTERM')
    posix.emit('close', null, 'SIGTERM')
    expect(await done2).toMatchObject({ ok: false, error: 'The scan was cancelled.' })
  })

  it('stops a scan that runs past the time limit', async () => {
    vi.useFakeTimers()
    try {
      const child = fakeChild(55)
      const killTree = vi.fn()
      const svc = createScannerService(deps({ killTree, spawn: fakeSpawn([child]) as unknown as ScannerDeps['spawn'] }))
      const done = svc.run(() => {})
      vi.advanceTimersByTime(15 * 60 * 1000 - 1)
      expect(killTree).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(killTree).toHaveBeenCalledWith(child)
      child.emit('close', 1, null)
      expect(await done).toMatchObject({ ok: false, error: 'The scan took longer than 15 minutes and was stopped.' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('scanner.run freshness and stopping', () => {
  it('a run that exits cleanly but saved no new file is not a success', async () => {
    const child = fakeChild()
    const same = vi.fn(async () => FIXTURE_FILES)
    const svc = createScannerService(deps({ readDir: same, spawn: fakeSpawn([child]) as unknown as ScannerDeps['spawn'] }))
    const done = svc.run(() => {})
    await tick()
    child.emit('close', 0, null)
    const out = await done
    expect(out.ok).toBe(false)
    expect(out.error).toContain('saved no new results')
  })

  it('a clean exit that saved no scan file at all says so', async () => {
    const child = fakeChild()
    const svc = createScannerService(deps({ readDir: vi.fn(async () => []), spawn: fakeSpawn([child]) as unknown as ScannerDeps['spawn'] }))
    const done = svc.run(() => {})
    await tick()
    child.emit('close', 0, null)
    expect((await done).error).toContain('saved no signals_scan_*.csv')
  })

  it('a rerun in the same minute counts when the file was rewritten', async () => {
    const child = fakeChild()
    const same = vi.fn(async () => FIXTURE_FILES)
    let t = 1000
    const mtime = vi.fn(async () => t)
    const svc = createScannerService(deps({ readDir: same, mtime, spawn: fakeSpawn([child]) as unknown as ScannerDeps['spawn'] }))
    const done = svc.run(() => {})
    await tick()
    t = 2000
    child.emit('close', 0, null)
    expect((await done).ok).toBe(true)
  })

  it('a missing scanner folder is explained (how to set it up), not reported as missing Python', async () => {
    const spawn = fakeSpawn([])
    const svc = createScannerService(deps({ exists: () => false, spawn: spawn as unknown as ScannerDeps['spawn'] }))
    const out = await svc.run(() => {})
    expect(out.error).toContain(DIR)
    expect(out.error).toContain('MC_SCANNER_DIR')
    expect(out.error).toContain('scan.py')
    expect(spawn).not.toHaveBeenCalled()
    await expect(svc.latest()).rejects.toThrow('MC_SCANNER_DIR')
  })

  it('a process that ignores the kill is let go after the backstop', async () => {
    vi.useFakeTimers()
    const child = fakeChild(555)
    const svc = createScannerService(deps({ killTree: vi.fn(), spawn: fakeSpawn([child]) as unknown as ScannerDeps['spawn'] }))
    const done = svc.run(() => {})
    svc.cancel()
    await vi.advanceTimersByTimeAsync(6000)
    const out = await done
    expect(out).toMatchObject({ ok: false, cancelled: true })
    expect(out.error).toContain('did not stop')
    vi.useRealTimers()
  })

  it('stopAll cancels a running scan and resolves', async () => {
    const a = fakeChild(1)
    const svc = createScannerService(deps({ killTree: vi.fn(() => setImmediate(() => a.emit('close', 1, null))), spawn: fakeSpawn([a]) as unknown as ScannerDeps['spawn'] }))
    const done = svc.run(() => {})
    await svc.stopAll()
    expect((await done).cancelled).toBe(true)
  })
})
