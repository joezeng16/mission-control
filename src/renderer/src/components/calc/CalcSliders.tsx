import { Slider } from 'radix-ui'
import { addDays, fmtDate } from '../../lib/format'
import { PL_COLORS } from '../../charts/plGeometry'

interface SliderRowProps {
  label: string
  value: string
  min: number
  max: number
  step: number
  current: number
  color: string
  onChange: (n: number) => void
  ends: [string, string]
  centered?: boolean
  onReset?: () => void
}

function SliderRow({ label, value, min, max, step, current, color, onChange, ends, centered, onReset }: SliderRowProps): React.JSX.Element {
  const span = max - min || 1
  const at = ((current - min) / span) * 100
  const zero = centered ? ((0 - min) / span) * 100 : 0
  const left = Math.min(at, zero)
  const width = Math.abs(at - zero)
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] font-medium text-fg-3">{label}</span>
        <span className="num truncate text-[12px] text-fg">
          {value}
          {onReset && (
            <button type="button" onClick={onReset} className="ring-focus ml-2 rounded text-[11px] text-fg-3 hover:text-fg">
              Reset
            </button>
          )}
        </span>
      </div>
      <Slider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        min={min}
        max={max}
        step={step}
        value={[current]}
        onValueChange={(v) => onChange(v[0])}
        aria-label={label}
      >
        <Slider.Track className="relative h-[4px] grow overflow-hidden rounded-full bg-white/[0.08]">
          <Slider.Range className="absolute h-full opacity-0" />
          <span className="absolute inset-y-0 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: color, boxShadow: `0 0 10px ${color}` }} />
        </Slider.Track>
        {centered && <span className="pointer-events-none absolute left-1/2 top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/30" />}
        <Slider.Thumb
          className="ring-focus block size-4 rounded-full border-2 bg-ink shadow-[0_0_0_4px_rgb(0_0_0/0.35)] transition-transform hover:scale-110"
          style={{ borderColor: color }}
        />
      </Slider.Root>
      <div className="mt-1 flex justify-between text-[10.5px] text-fg-4">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  )
}

interface CalcSlidersProps {
  today: string
  totalDays: number
  dateDays: number
  onDateDays: (n: number) => void
  ivShift: number
  onIvShift: (n: number) => void
  baseIv: number | null
}

/** "Normal (37%)", "Wilder: 47% (normally 37%)", "Calmer: 27% (normally 37%)". */
function swingText(baseIv: number | null, pts: number): string {
  const word = pts > 0 ? 'Wilder' : pts < 0 ? 'Calmer' : 'Normal'
  if (baseIv == null) return pts === 0 ? word : `${word}: ${pts > 0 ? '+' : '−'}${Math.abs(pts)} pts`
  const now = Math.round(baseIv * 100)
  return pts === 0 ? `${word} (${now}%)` : `${word}: ${Math.max(1, Math.round((baseIv + pts / 100) * 100))}% (normally ${now}%)`
}

/** Date (today → expiry) and the price-swings what-if in IV points (−50 … +50). */
export function CalcSliders({ today, totalDays, dateDays, onDateDays, ivShift, onIvShift, baseIv }: CalcSlidersProps): React.JSX.Element {
  const date = addDays(today, dateDays)
  const left = totalDays - dateDays
  const pts = Math.round(ivShift * 100)
  return (
    <div className="flex gap-6">
      <SliderRow
        label="Date"
        value={dateDays === 0 ? 'Today' : left === 0 ? `${fmtDate(date)}, expiry` : `${fmtDate(date)}, ${left} day${left === 1 ? '' : 's'} before expiry`}
        min={0}
        max={Math.max(totalDays, 1)}
        step={1}
        current={dateDays}
        color={PL_COLORS.date}
        onChange={onDateDays}
        ends={['Today', fmtDate(addDays(today, totalDays))]}
      />
      <SliderRow
        label="Price swings (what-if)"
        value={swingText(baseIv, pts)}
        min={-50}
        max={50}
        step={1}
        current={pts}
        color={PL_COLORS.today}
        onChange={(n) => onIvShift(n / 100)}
        ends={['Calmer', 'Wilder']}
        centered
        onReset={pts !== 0 ? () => onIvShift(0) : undefined}
      />
    </div>
  )
}
