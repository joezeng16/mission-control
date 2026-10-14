/** Clock hooks: re-render on a slow beat so time-based labels and the market-hours state stay true. */
import { useEffect, useState } from 'react'
import { appNowMs } from './clock'
import { marketStatus } from './time'

/** The app clock's ms, refreshed every `everyMs` while `on` (a local timer only: no network). */
export function useNow(everyMs: number, on = true): number {
  const [now, setNow] = useState(appNowMs)
  useEffect(() => {
    if (!on) return undefined
    setNow(appNowMs())
    const id = setInterval(() => setNow(appNowMs()), everyMs)
    return () => clearInterval(id)
  }, [everyMs, on])
  return now
}

/** The regular session (9:30 AM - 4:00 PM ET) is open right now. Checked every 30 s. */
export function useMarketOpen(): boolean {
  return marketStatus(new Date(useNow(30_000))).open
}
