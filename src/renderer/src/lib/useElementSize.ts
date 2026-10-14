import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

export interface Size {
  width: number
  height: number
}

/** Live width / height of an element (ResizeObserver). */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, Size] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = (): void => {
      const width = Math.round(el.clientWidth)
      const height = Math.round(el.clientHeight)
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}
