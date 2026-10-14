/**
 * The clock the market-hours checks read. The app always uses the real time; only the browser preview (npm run dev:web)
 * may shift it (?clock=open) so the market-hours screens can be checked in the evening. Nothing else ever sets the offset.
 */
let offsetMs = 0

export function setPreviewClockOffset(ms: number): void {
  offsetMs = Number.isFinite(ms) ? ms : 0
}

export function appNowMs(): number {
  return Date.now() + offsetMs
}

export function appNow(): Date {
  return new Date(appNowMs())
}
