/** Scales and SVG paths for the P/L chart (pure, so the component stays presentational). */
import { scaleLinear, type ScaleLinear } from 'd3-scale'
import { area, curveMonotoneX, line } from 'd3-shape'

export interface PLPoint {
  x: number
  expiry: number
  at: number
  today: number
}

export const MARGIN = { top: 34, right: 18, bottom: 30, left: 64 }

export const PL_COLORS = {
  profit: '#00c805',
  loss: '#ff5000',
  today: '#3ad8ff',
  date: '#ffb547'
} as const

export interface Geometry {
  x: ScaleLinear<number, number>
  y: ScaleLinear<number, number>
  zero: number
  /** y of the expiry curve's best profit / deepest loss: the fills fade from there to $0. */
  peak: number
  trough: number
  expiry: string
  area: string
  today: string
  at: string | null
  baseToday: string | null
  baseAt: string | null
  xTicks: number[]
  yTicks: number[]
  plotRight: number
  plotBottom: number
}

type Get = (p: PLPoint) => number

function pathOf(points: readonly PLPoint[], x: ScaleLinear<number, number>, y: ScaleLinear<number, number>, get: Get): string {
  return line<PLPoint>().x((p) => x(p.x)).y((p) => y(get(p))).curve(curveMonotoneX)(points as PLPoint[]) ?? ''
}

export function buildGeometry(
  points: readonly PLPoint[], base: readonly PLPoint[] | null, width: number, height: number, showDate: boolean
): Geometry | null {
  if (width < 80 || height < 80 || points.length < 2) return null
  const plotRight = width - MARGIN.right
  const plotBottom = height - MARGIN.bottom
  const x = scaleLinear().domain([points[0].x, points[points.length - 1].x]).range([MARGIN.left, plotRight])
  const all = [...points, ...(base ?? [])]
  const values = all.flatMap((p) => (showDate ? [p.expiry, p.today, p.at] : [p.expiry, p.today]))
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const pad = (hi - lo) * 0.08 || 1
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([plotBottom, MARGIN.top]).nice(6)
  const zero = y(0)
  const expiryValues = points.map((p) => p.expiry)
  const areaPath = area<PLPoint>().x((p) => x(p.x)).y0(zero).y1((p) => y(p.expiry)).curve(curveMonotoneX)(points as PLPoint[]) ?? ''
  return {
    x,
    y,
    zero,
    peak: Math.min(y(Math.max(0, ...expiryValues)), zero - 1),
    trough: Math.max(y(Math.min(0, ...expiryValues)), zero + 1),
    expiry: pathOf(points, x, y, (p) => p.expiry),
    area: areaPath,
    today: pathOf(points, x, y, (p) => p.today),
    at: showDate ? pathOf(points, x, y, (p) => p.at) : null,
    baseToday: base ? pathOf(base, x, y, (p) => p.today) : null,
    baseAt: base && showDate ? pathOf(base, x, y, (p) => p.at) : null,
    xTicks: x.ticks(Math.max(3, Math.floor(width / 110))),
    yTicks: y.ticks(Math.max(3, Math.floor(height / 70))),
    plotRight,
    plotBottom
  }
}

const READOUT_H = 152

/** Put the hover box above or below the curves next to the cursor, whichever slot is clear. */
export function readoutTop(g: Geometry, points: readonly PLPoint[], x0: number, x1: number, value: (p: readonly PLPoint[], x: number, k: keyof PLPoint) => number): number {
  const xs = [0, 0.25, 0.5, 0.75, 1].map((t) => g.x.invert(Math.min(Math.max(x0 + (x1 - x0) * t, MARGIN.left), g.plotRight)))
  const ys = xs.flatMap((x) => (['expiry', 'at', 'today'] as const).map((k) => g.y(value(points, x, k))))
  const lo = Math.min(...ys, g.zero)
  const hi = Math.max(...ys, g.zero)
  const top = MARGIN.top + 4
  const bottom = g.plotBottom - READOUT_H - 26
  if (top + READOUT_H < lo) return top
  if (bottom > hi) return bottom
  return lo - top > bottom - hi ? top : bottom
}

export interface TagBox { x: number; y: number; w: number; h: number }

const TAG_GAP = 9
const TAG_PAD = 3
const STRIKE_LABEL_ROOM = 26   // keep tags clear of the strike labels along the bottom

/** Where the "Breakeven $X" tag goes next to its dot: the first corner (above-left, above-right, below-right, below-left)
 *  whose box no curve (and no horizontal guide at the `guides` pixel ys) crosses, so the label never sits on the lines. */
export function breakevenTag(
  g: Geometry, points: readonly PLPoint[], bx: number, w: number, h: number, showDate: boolean,
  value: (p: readonly PLPoint[], x: number, k: keyof PLPoint) => number, guides: number[] = []
): TagBox {
  const keys: (keyof PLPoint)[] = showDate ? ['expiry', 'today', 'at'] : ['expiry', 'today']
  const corners = [
    { x: bx - TAG_GAP - w, y: g.zero - TAG_GAP - h },
    { x: bx + TAG_GAP, y: g.zero - TAG_GAP - h },
    { x: bx + TAG_GAP, y: g.zero + TAG_GAP },
    { x: bx - TAG_GAP - w, y: g.zero + TAG_GAP }
  ]
  const fits = (b: TagBox): boolean =>
    b.x >= MARGIN.left && b.x + b.w <= g.plotRight && b.y >= MARGIN.top && b.y + b.h <= g.plotBottom - STRIKE_LABEL_ROOM
  const hits = (b: TagBox): number => {
    let n = guides.filter((y) => y >= b.y - TAG_PAD && y <= b.y + b.h + TAG_PAD).length * 9
    for (let k = 0; k <= 8; k++) {
      const x = g.x.invert(b.x + (b.w * k) / 8)
      for (const key of keys) {
        const y = g.y(value(points, x, key))
        if (y >= b.y - TAG_PAD && y <= b.y + b.h + TAG_PAD) n++
      }
    }
    return n
  }
  const boxes = corners.map((c) => ({ ...c, w, h })).filter(fits)
  const scored = boxes.map((b) => ({ b, n: hits(b) }))
  const best = scored.reduce<{ b: TagBox; n: number } | null>((a, s) => (!a || s.n < a.n ? s : a), null)
  return best?.b ?? { x: bx + TAG_GAP, y: g.zero + TAG_GAP, w, h }
}
