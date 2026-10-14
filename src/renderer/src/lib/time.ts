/** Clock helpers. The scanner stamps its files in New York time, and the app shows market times in New York time (ET),
 *  the US market's own clock. */

interface ZonedParts {
  date: string // YYYY-MM-DD
  hour: number
  minute: number
  weekday: number // 0 = Sunday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const NEW_YORK = 'America/New_York'

function zoned(now: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(now)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAYS.indexOf(get('weekday'))
  }
}

/** Today's date in New York (the market's calendar). */
export function nyToday(now: Date = new Date()): string {
  return zoned(now, NEW_YORK).date
}

/** 'YYYY-MM-DD HH:MM' in New York right now. */
export function nyStamp(now: Date = new Date()): string {
  const z = zoned(now, NEW_YORK)
  return `${z.date} ${pad(z.hour)}:${pad(z.minute)}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function clock12(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`
}

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' })

/** 'YYYY-MM-DD HH:MM' (New York) -> { day: 'Mon, Oct 12', time: '8:46 PM ET' }. */
export function nyStampLabel(stamp: string): { day: string; time: string } {
  const [d, t = '00:00'] = stamp.trim().split(/\s+/)
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const at = new Date(Date.UTC(y, mo - 1, da, h, mi))
  return { day: monthDay.format(at), time: `${clock12(at.getUTCHours(), at.getUTCMinutes())} ET` }
}

/** True when the scan file is not from today (New York calendar). */
export function isStale(stamp: string, now: Date = new Date()): boolean {
  return stamp.slice(0, 10) !== nyToday(now)
}

export interface MarketStatus {
  open: boolean
  label: string
  clock: string
}

const OPEN_MIN = 9 * 60 + 30
const CLOSE_MIN = 16 * 60

/** Regular session 9:30 AM – 4:00 PM ET, Monday to Friday (holidays not counted). */
export function marketStatus(now: Date = new Date()): MarketStatus {
  const ny = zoned(now, NEW_YORK)
  const mins = ny.hour * 60 + ny.minute
  const weekday = ny.weekday >= 1 && ny.weekday <= 5
  const open = weekday && mins >= OPEN_MIN && mins < CLOSE_MIN
  const clock = `${clock12(ny.hour, ny.minute)} ET`
  if (open) return { open, clock, label: 'Market open until 4:00 PM ET' }
  const beforeOpen = weekday && mins < OPEN_MIN
  return { open, clock, label: beforeOpen ? 'Market opens 9:30 AM ET' : 'Market closed' }
}

/** For a scan run outside 9:30 AM – 4:00 PM New York: was it before that day's open, or after a close? */
export function offHoursWord(stamp: string): 'before the open' | 'after the close' {
  const [d, t = '00:00'] = stamp.trim().split(/\s+/)
  const day = new Date(`${d}T12:00:00Z`).getUTCDay()
  return day >= 1 && day <= 5 && t < '09:30' ? 'before the open' : 'after the close'
}
