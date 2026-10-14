/** Reads the scanner's CSVs (columns documented in the README) into the shared contract types. Pure: no file access. */
import { basename } from 'node:path'
import { TAKE_PROFIT_LEFT } from '../shared/defaults'
import type { ExitRow, ExitTag, Level, PutQuote, Signal, Tested } from '../shared/types'
import { EXITS_PREFIX, SCAN_PREFIX } from './paths'

/** One CSV data row keyed by the header's column names (missing cells are ''). */
type Row = Readonly<Record<string, string>>

/**
 * RFC 4180 CSV, tolerant: quoted fields may hold commas, newlines and doubled quotes; CRLF, LF or CR line ends;
 * a leading BOM is dropped; blank lines are skipped; an unclosed quote runs to the end of the text.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const endRow = (): void => {
    const done = [...row, field]
    if (done.length > 1 || done[0] !== '') rows.push(done)
    row = []
    field = ''
  }
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (text[i + 1] === '"') field += text[++i]
      else quoted = false
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      row = [...row, field]
      field = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else field += ch
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

function toRows(text: string): Row[] {
  const [header, ...body] = parseCsv(text)
  if (!header) return []
  const keys = header.map((h) => h.trim())
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ''])))
}

const NULL_WORDS = new Set(['', 'nan', 'none', 'nat', 'null'])

function str(row: Row, key: string): string | null {
  const v = (row[key] ?? '').trim()
  return NULL_WORDS.has(v.toLowerCase()) ? null : v
}

function num(row: Row, key: string): number | null {
  const v = str(row, key)
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The scanner writes win rates and averages as percents (96.15); the app passes fractions (0.9615). */
function pct(row: Row, key: string): number | null {
  const n = num(row, key)
  return n === null ? null : n / 100
}

/** 'YYYY-MM-DD' from a date or a pandas timestamp ('2026-11-20 00:00:00'). */
function day(row: Row, key: string): string | null {
  const m = str(row, key)?.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function bool(row: Row, key: string): boolean {
  return /^(true|1|yes)$/i.test((row[key] ?? '').trim())
}

/** '3/3' (or a bare 3 in the `lv` column) -> 3. */
function level(row: Row): Level | null {
  for (const key of ['level', 'lv']) {
    const m = str(row, key)?.match(/^([123])(?:\s*\/\s*3)?$/)
    if (m) return Number(m[1]) as Level
  }
  return null
}

const KINDS: readonly Signal['kind'][] = ['tagged', 'forming', 'near']

function kindOf(row: Row): Signal['kind'] | null {
  const k = str(row, 'kind')?.toLowerCase()
  return KINDS.find((x) => x === k) ?? null
}

/** The put from the put_* columns. Without put_buyback the buy-back is the take-profit rule applied to the mid. */
function toPut(row: Row): PutQuote | null {
  const expiry = day(row, 'put_exp')
  const strike = num(row, 'put_strike')
  if (expiry === null || strike === null) return null
  const bid = num(row, 'put_bid')
  const ask = num(row, 'put_ask')
  const mid = num(row, 'put_mid')
  const liveCell = str(row, 'put_live')
  return {
    expiry, strike, bid, ask, mid,
    spreadPct: num(row, 'put_spread'), delta: num(row, 'put_delta'), note: str(row, 'put_note'),
    wingStrike: num(row, 'put_wing_strike'), wingMid: num(row, 'put_wing_mid'),
    credit: num(row, 'put_credit'), width: num(row, 'put_width'),
    buyback: num(row, 'put_buyback') ?? (mid !== null ? TAKE_PROFIT_LEFT * mid : null),
    live: liveCell !== null ? bool(row, 'put_live') : (bid ?? 0) > 0 && (ask ?? 0) > 0
  }
}

/** The optional tested_* columns (a backtest of every signal at this level); null when the scanner writes none. */
function toTested(row: Row): Tested | null {
  const t: Tested = {
    putWon: pct(row, 'tested_won'), putAvg: pct(row, 'tested_avg'),
    spreadWon: pct(row, 'tested_spread_won'), spreadMid: pct(row, 'tested_spread_mid'), spreadNatural: pct(row, 'tested_spread_natural')
  }
  return Object.values(t).every((v) => v === null) ? null : t
}

function toSignal(row: Row): Signal | null {
  const ticker = str(row, 'ticker')
  const lv = level(row)
  const date = day(row, 'date')
  const kind = kindOf(row)
  const priceThen = num(row, 'price_then')
  const priceNow = num(row, 'price_now')
  const daysAgo = kind === 'tagged' ? num(row, 'days_ago') : -1
  if (!ticker || lv === null || !date || !kind || daysAgo === null || priceThen === null || priceNow === null) return null
  return {
    ticker, level: lv, kind, date, daysAgo,
    priceThen, priceNow,
    won: pct(row, 'won_pct'), trades: num(row, 'trades') ?? 0,
    nextEarn: day(row, 'next_earn'), tested: toTested(row),
    borderline: bool(row, 'borderline'), detail: str(row, 'detail'),
    put: toPut(row)
  }
}

/** The exit tags a scanner may write (case and extra spaces don't matter); a row with any other tag is skipped. */
const EXIT_TAGS: ReadonlyMap<string, ExitTag> = new Map<string, ExitTag>([
  ['TP', 'TP'], ['TP 1', 'TP 1'], ['TP 2', 'TP 2'], ['STOP LOSS', 'STOP LOSS'], ['TIME', 'TIME']
])

function toExit(row: Row): ExitRow | null {
  const ticker = str(row, 'ticker')
  const lv = level(row)
  const date = day(row, 'date')
  const enter = day(row, 'enter')
  const tag = EXIT_TAGS.get((str(row, 'tag') ?? '').replace(/\s+/g, ' ').toUpperCase())
  const enterPrice = num(row, 'enter_price')
  const price = num(row, 'price')
  const move = num(row, 'move')
  const forming = bool(row, 'forming')
  const daysAgo = forming ? -1 : num(row, 'days_ago')
  if (!ticker || lv === null || !date || !enter || !tag || daysAgo === null) return null
  if (enterPrice === null || price === null || move === null) return null
  return { ticker, level: lv, enter, enterPrice, tag, date, daysAgo, price, move, forming }
}

function parseRows<T>(text: string, toItem: (row: Row) => T | null): { items: T[]; skipped: number } {
  const parsed = toRows(text).map(toItem)
  const items = parsed.filter((x): x is T => x !== null)
  return { items, skipped: parsed.length - items.length }
}

/** Columns the app relies on. A missing one means the scanner changed: the app says so instead of showing blanks. */
export const EXPECTED_COLUMNS: readonly string[] = [
  'ticker', 'level', 'kind', 'date', 'days_ago', 'price_then', 'price_now', 'won_pct', 'trades', 'next_earn', 'borderline',
  'put_exp', 'put_strike', 'put_mid'
]

/** `signals_scan_*.csv` -> signals; rows without a ticker, level, date, kind or prices are skipped and counted.
 *  `warnings` names expected columns the file lacks; `version` is the scanner's own label (null when it writes none). */
export function parseScanCsv(text: string): { signals: Signal[]; skipped: number; warnings: string[]; version: string | null } {
  const header = (parseCsv(text)[0] ?? []).map((h) => h.trim())
  const { items, skipped } = parseRows(text, toSignal)
  const missing = header.length === 0 ? [] : EXPECTED_COLUMNS.filter((c) => !header.includes(c))
  const warnings = [
    ...(missing.length ? [`This scan file has no ${missing.join(', ')} column${missing.length > 1 ? 's' : ''} (the scanner changed?): those numbers show as blank.`] : []),
    ...(skipped ? [`${skipped} row${skipped > 1 ? 's' : ''} in the scan file could not be read and ${skipped > 1 ? 'are' : 'is'} not shown.`] : [])
  ]
  const version = toRows(text).map((r) => str(r, 'scanner')).find((v) => v !== null) ?? null
  return { signals: items, skipped, warnings, version }
}

/** A 'YYYY-MM-DD HH:MM' New York time falls on a weekday between 9:30 AM and 4:00 PM (holidays not known). */
export function marketOpenAt(ny: string): boolean {
  const d = new Date(`${ny.slice(0, 10)}T12:00:00Z`).getUTCDay()
  const hm = ny.slice(11, 16)
  return d >= 1 && d <= 5 && hm >= '09:30' && hm < '16:00'
}

/** `signals_exits_*.csv` -> exit rows (extra columns are ignored); broken rows are skipped and counted. */
export function parseExitsCsv(text: string): { exits: ExitRow[]; skipped: number } {
  const { items, skipped } = parseRows(text, toExit)
  return { exits: items, skipped }
}

function stampOf(file: string, prefix: string): string | null {
  const m = basename(file).match(new RegExp(`^${prefix}_(\\d{4}-\\d{2}-\\d{2}_\\d{4})\\.csv$`, 'i'))
  return m ? m[1] : null
}

/** The newest `signals_scan_<YYYY-MM-DD_HHMM>.csv` by the stamp in its name (not mtime) and the exits file of the same run. */
export function newestScanFiles(files: string[]): { scan: string | null; exits: string | null; stamp: string | null } {
  const newest = files.reduce<{ file: string; stamp: string } | null>((best, file) => {
    const stamp = stampOf(file, SCAN_PREFIX)
    return stamp !== null && (best === null || stamp > best.stamp) ? { file, stamp } : best
  }, null)
  if (newest === null) return { scan: null, exits: null, stamp: null }
  const exits = files.find((file) => stampOf(file, EXITS_PREFIX) === newest.stamp) ?? null
  return { scan: newest.file, exits, stamp: newest.stamp }
}

/** '2026-10-12_2046' -> '2026-10-12 20:46' (New York time, as the scanner names its files). */
export function stampToNy(stamp: string): string {
  return `${stamp.slice(0, 10)} ${stamp.slice(11, 13)}:${stamp.slice(13, 15)}`
}
