import { Tip } from '../Tip'

/** Where the calculator's option prices come from: Yahoo, about 15 minutes behind the market. */
export function QuoteSource(): React.JSX.Element {
  return (
    <Tip content="Option prices from Yahoo (unofficial, about 15 minutes behind). Check your broker's live quote before you trade." align="end">
      <span tabIndex={0} className="ring-focus inline-flex items-center gap-1.5 rounded text-[11px] font-medium text-fg-3">
        <span className="size-1.5 rounded-full bg-fg-4" aria-hidden="true" />
        Yahoo · about 15 min delayed
      </span>
    </Tip>
  )
}
