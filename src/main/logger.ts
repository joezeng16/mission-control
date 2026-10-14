/** A small log file for diagnosis: <userData>/logs/main.log, on Windows %APPDATA%\Options Desk\logs\main.log
 *  (rolled to main.old.log past 1 MB). Every line is cleaned before it is written (token-like strings hidden,
 *  account-number-like strings cut to the last 4).
 *  Logging must never break the app, so every failure here is swallowed. */
import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanLogLine } from './log-text'

const MAX_BYTES = 1_000_000
let file: string | null = null

export function logPath(): string {
  if (!file) {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'main.log')
  }
  return file
}

function detail(err: unknown): string {
  if (err === undefined) return ''
  return ` :: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
}

export function log(level: 'info' | 'warn' | 'error', msg: string, err?: unknown): void {
  try {
    const p = logPath()
    try {
      if (statSync(p).size > MAX_BYTES) renameSync(p, p.replace(/\.log$/, '.old.log'))
    } catch {
      /* no file yet */
    }
    appendFileSync(p, `${cleanLogLine(`${new Date().toISOString()} ${level.toUpperCase()} ${msg}${detail(err)}`)}\n`)
  } catch {
    /* logging must never crash the app */
  }
}
