import { useCallback, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { useElementSize } from '../lib/useElementSize'

interface SplitProps {
  left: ReactNode
  right: ReactNode
  storageKey: string
  defaultFraction?: number
  minLeftPx?: number
  minRightPx?: number
  /** True while the divider is being dragged (the TradingView view hides so it can't swallow the drag). */
  onDragChange?: (dragging: boolean) => void
}

function readStored(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return v > 0.15 && v < 0.85 ? v : fallback
  } catch {
    return fallback
  }
}

function store(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    /* storage can be unavailable; the split just won't be remembered */
  }
}

/** Two panes with a draggable, keyboard-adjustable divider. */
export function Split({ left, right, storageKey, defaultFraction = 0.45, minLeftPx = 600, minRightPx = 420, onDragChange }: SplitProps): React.JSX.Element {
  const [box, size] = useElementSize<HTMLDivElement>()
  const [fraction, setFraction] = useState(() => readStored(storageKey, defaultFraction))
  const [dragging, setDragging] = useState(false)

  const clampPx = useCallback(
    (f: number): number => {
      const w = size.width || 1200
      const lo = Math.min(minLeftPx / w, 0.8)
      const hi = Math.max(1 - minRightPx / w, lo)
      return Math.min(Math.max(f, lo), hi)
    },
    [minLeftPx, minRightPx, size.width]
  )

  const setDrag = (v: boolean): void => {
    setDragging(v)
    onDragChange?.(v)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging || !box.current) return
    const r = box.current.getBoundingClientRect()
    setFraction(clampPx((e.clientX - r.left) / r.width))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDrag(false)
    store(storageKey, fraction)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 0.05 : 0.02
    const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    if (delta === 0) return
    e.preventDefault()
    const next = clampPx(fraction + delta)
    setFraction(next)
    store(storageKey, next)
  }

  const shown = clampPx(fraction)
  return (
    <div ref={box} className={cn('flex h-full min-h-0 w-full', dragging && 'cursor-col-resize select-none')}>
      <div className="h-full min-w-0" style={{ flexBasis: `${shown * 100}%`, flexShrink: 0 }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the list and the chart"
        aria-valuenow={Math.round(shown * 100)}
        aria-valuemin={20}
        aria-valuemax={80}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKey}
        onDoubleClick={() => setFraction(clampPx(defaultFraction))}
        className="ring-focus group relative w-3 shrink-0 cursor-col-resize touch-none"
      >
        <div
          className={cn(
            'absolute inset-y-6 left-1/2 w-px -translate-x-1/2 bg-line transition-colors duration-150 group-hover:bg-profit/60',
            dragging && 'bg-profit shadow-[0_0_10px_rgb(0_200_5/0.8)]'
          )}
        />
        <div
          className={cn(
            'absolute left-1/2 top-1/2 h-9 w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-line-2 bg-ink-3 transition-colors group-hover:border-profit/70',
            dragging && 'border-profit'
          )}
        />
      </div>
      <div className="h-full min-w-0 flex-1">{right}</div>
    </div>
  )
}
