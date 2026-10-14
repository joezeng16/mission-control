/** Linear interpolation of a curve's value at x (points sorted by x). */
export interface XPoint {
  x: number
}

export function valueAt<P extends XPoint>(points: readonly P[], x: number, get: (p: P) => number): number | null {
  if (points.length === 0) return null
  if (x <= points[0].x) return get(points[0])
  const last = points[points.length - 1]
  if (x >= last.x) return get(last)
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (points[m].x <= x) lo = m
    else hi = m
  }
  const a = points[lo]
  const b = points[hi]
  const t = (x - a.x) / (b.x - a.x || 1)
  return get(a) + (get(b) - get(a)) * t
}
