import { useLayoutEffect, useRef } from 'react'
import type { Bounds } from '@shared/types'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { TvPlaceholder } from './TvPlaceholder'

interface TvPaneProps {
  symbol: string | null
  intervalLabel: string
  loading: boolean
  /** Hide the real view for a moment (e.g. while the split divider is dragged). */
  suspended?: boolean
  className?: string
}

const SETTLE_MS = 700

function measure(el: HTMLElement): Bounds {
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
}

/**
 * Where the real TradingView view sits. This div reports its screen box to the main process on mount, resize, scroll and
 * window resize (and for a short moment after each, so tab animations settle), and reports null when it goes away.
 */
export function TvPane({ symbol, intervalLabel, loading, suspended = false, className }: TvPaneProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (suspended) {
      api.tv.setBounds(null)
      return undefined
    }
    let last = ''
    let raf = 0
    let settleUntil = 0
    const send = (): void => {
      const b = measure(el)
      const key = `${b.x},${b.y},${b.width},${b.height}`
      if (key === last) return
      last = key
      api.tv.setBounds(b.width > 0 && b.height > 0 ? b : null)
    }
    const loop = (): void => {
      send()
      raf = performance.now() < settleUntil ? requestAnimationFrame(loop) : 0
    }
    const settle = (): void => {
      settleUntil = performance.now() + SETTLE_MS
      if (raf === 0) loop()
    }
    const ro = new ResizeObserver(settle)
    ro.observe(el)
    window.addEventListener('resize', settle)
    window.addEventListener('scroll', settle, true)
    settle()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', settle)
      window.removeEventListener('scroll', settle, true)
      api.tv.setBounds(null)
    }
  }, [suspended])

  return (
    <div ref={ref} data-tv-pane className={cn('relative min-h-0 overflow-hidden rounded-xl bg-[#07080d]', className)}>
      <TvPlaceholder symbol={symbol} intervalLabel={intervalLabel} loading={loading} suspended={suspended} />
    </div>
  )
}
