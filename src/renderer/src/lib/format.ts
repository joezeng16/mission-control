/** Number and date formatting for everything the app shows. Dates are ISO 'YYYY-MM-DD' strings treated as calendar days. */
const MINUS = '−'

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const plain2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface MoneyOptions {
  decimals?: 0 | 2
  sign?: boolean
}

/** n rounded to what is shown (whole dollars or cents), so a −$0.30 P/L reads "$0", never "−$0". */
export function shown(n: number, decimals: 0 | 2 = 0): number {
  const f = decimals === 2 ? 100 : 1
  const r = Math.round(n * f + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) / f
  return r === 0 ? 0 : r
}

/** True when n is a loss once rounded the way it is shown (color the number red only then). */
export function isLoss(n: number, decimals: 0 | 2 = 0): boolean {
  return Number.isFinite(n) && shown(n, decimals) < 0
}

/** $1,234 / +$1,234 / −$1,234 (real minus sign). Rounds before choosing the sign, so it never prints "−$0". */
export function money(n: number, opts: MoneyOptions = {}): string {
  if (!Number.isFinite(n)) return '—'
  const decimals = opts.decimals === 2 ? 2 : 0
  const r = shown(n, decimals)
  const body = (decimals === 2 ? usd2 : usd0).format(Math.abs(r))
  if (r < 0) return `${MINUS}${body}`
  return opts.sign && r > 0 ? `+${body}` : body
}

/** $1.2K, $70K, $1.4M — for axes and tight cells. */
export function compactMoney(n: number, sign = false): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  const body = a >= 1e6 ? `$${trim(a / 1e6)}M` : a >= 1e4 ? `$${Math.round(a / 1e3)}K` : a >= 1e3 ? `$${trim(a / 1e3)}K` : `$${Math.round(a)}`
  if (body === '$0') return body
  if (n < 0) return `${MINUS}${body}`
  return sign && n > 0 ? `+${body}` : body
}

function trim(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '')
}

/** $799.37 */
export function price(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : usd2.format(n)
}

/** 9.70 (no $) */
export function dec2(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : plain2.format(n)
}

/** A fraction as a percent: 0.268 -> 27% (or 26.8% with decimals = 1). */
export function pct(f: number | null | undefined, decimals = 0, sign = false): string {
  if (f == null || !Number.isFinite(f)) return '—'
  const v = (Math.abs(f) * 100).toFixed(decimals)
  if (f < 0 && Number(v) !== 0) return `${MINUS}${v}%`
  return sign && f > 0 ? `+${v}%` : `${v}%`
}

/** Strike without trailing zeros: 700 -> "700", 62.5 -> "62.50" style kept short: "62.5". */
export function strike(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

function parseIso(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

const dayMonth = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const dayMonthYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const weekdayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })

/** 'Oct 29', or 'Oct 15, 2027' when the year differs from refYear. */
export function fmtDate(iso: string | null | undefined, refYear?: number): string {
  if (!iso) return '—'
  const t = parseIso(iso)
  const year = new Date(t).getUTCFullYear()
  return refYear != null && year !== refYear ? dayMonthYear.format(t) : dayMonth.format(t)
}

export function weekday(iso: string): string {
  return weekdayFmt.format(parseIso(iso))
}

/** Whole calendar days from a to b (b later = positive). */
export function daysBetween(aIso: string, bIso: string): number {
  return Math.round((parseIso(bIso) - parseIso(aIso)) / 86_400_000)
}

/** ISO date n days after iso. */
export function addDays(iso: string, n: number): string {
  return new Date(parseIso(iso) + n * 86_400_000).toISOString().slice(0, 10)
}

/** "today", "1 day ago", "3 days ago". */
export function agoLabel(days: number): string {
  if (days <= 0) return 'today'
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/** "in 17 days", "tomorrow", "today", "passed". */
export function inDaysLabel(days: number): string {
  if (days < 0) return 'passed'
  if (days === 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

/** Today's date on your own calendar (this computer's time zone, or `timeZone` when given). The calculator counts days to
 *  expiry from it, so a Friday expiry never reads 0 days on Thursday evening west of New York. */
export function localToday(now: Date = new Date(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
