/** Calendar-day math on 'YYYY-MM-DD' strings (UTC, so no daylight-saving drift). */
const DAY_MS = 86_400_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(s: string): boolean {
  return ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}

function toUtc(s: string): number {
  if (!isIsoDate(s)) throw new Error(`Not a YYYY-MM-DD date: ${s}`)
  return Date.parse(`${s}T00:00:00Z`)
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS)
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + Math.round(days) * DAY_MS).toISOString().slice(0, 10)
}
