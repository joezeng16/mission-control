import { LoaderCircle } from 'lucide-react'
import { isPreview } from '../../lib/api'

interface TvPlaceholderProps {
  symbol: string | null
  intervalLabel: string
  loading: boolean
  suspended: boolean
}

/** A plain chart grid behind the real TradingView view (no made-up candles: this must never look like a real chart). */
function Grid(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 opacity-60"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgb(255 255 255 / 0.045) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.045) 1px, transparent 1px)',
        backgroundSize: '64px 48px'
      }}
    />
  )
}

function lineFor(symbol: string | null, suspended: boolean): string {
  if (suspended) return 'Let go to put the chart back.'
  if (isPreview) return 'Your TradingView chart appears here in the app.'
  return symbol ? `Opening ${symbol} on TradingView…` : 'Pick a stock to open its chart.'
}

export function TvPlaceholder({ symbol, intervalLabel, loading, suspended }: TvPlaceholderProps): React.JSX.Element {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <Grid />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(7_8_13/0.2),rgb(7_8_13/0.85)_75%)]" />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <div className="text-[44px] font-semibold leading-none tracking-[-0.03em] text-fg">{symbol ?? 'TradingView'}</div>
        <div className="text-[12.5px] text-fg-3">{symbol ? `${intervalLabel} chart` : 'No stock picked yet'}</div>
        <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1.5 text-[12px] text-fg-2">
          {(loading || (symbol != null && !isPreview)) && !suspended && <LoaderCircle size={13} className="animate-spin text-profit" />}
          {lineFor(symbol, suspended)}
        </div>
      </div>
    </div>
  )
}
