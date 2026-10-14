import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useRef } from 'react'

interface TweenNumberProps {
  value: number
  format: (n: number) => string
  /** Jump straight to the value (e.g. while the cursor drags across the chart). */
  instant?: boolean
  className?: string
}

/** A number that glides to its new value. Respects reduced motion. */
export function TweenNumber({ value, format, instant = false, className }: TweenNumberProps): React.JSX.Element {
  const reduce = useReducedMotion()
  const formatRef = useRef(format)
  formatRef.current = format
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => formatRef.current(v))

  useEffect(() => {
    if (instant || reduce) {
      mv.set(value)
      return undefined
    }
    const controls = animate(mv, value, { duration: 0.5, ease: [0.16, 1, 0.3, 1] })
    return () => controls.stop()
  }, [value, instant, reduce, mv])

  return <motion.span className={className}>{text}</motion.span>
}
