import { TriangleAlert } from 'lucide-react'
import { cn } from '../../lib/cn'
import { dec2, pct, price } from '../../lib/format'
import { mid, spreadPct, type LegView } from '../../lib/position'
import { isWide } from '../../lib/signals'
import { Tip } from '../Tip'

interface LegQuotesProps {
  legs: LegView[]
  spot: number
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] text-fg-3">{label}</span>
      <span className={cn('num text-[12.5px] text-fg', className)}>{value}</span>
    </div>
  )
}

/** The chain's bid / ask / mid / spread for each leg, with a WIDE warning over 15%. */
export function LegQuotes({ legs, spot }: LegQuotesProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {legs.map((leg) => {
        const c = leg.contract
        const sp = c ? spreadPct(c) : null
        const wide = isWide(sp)
        return (
          <div key={leg.label} className="glass-inset px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[12px] font-medium text-fg">{leg.label}</span>
              {wide && (
                <Tip content="Wide gap between bid and ask. Use a limit order near the mid.">
                  <span tabIndex={0} className="ring-focus inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-warn/15 px-1.5 text-[10px] font-semibold leading-[17px] text-warn">
                    <TriangleAlert size={10} /> WIDE
                  </span>
                </Tip>
              )}
            </div>
            {c ? (
              <div className="mt-2 grid grid-cols-4 gap-2">
                <Cell label="Bid" value={dec2(c.bid)} />
                <Cell label="Ask" value={dec2(c.ask)} />
                <Cell label="Mid" value={dec2(mid(c))} />
                <Cell label="Spread" value={pct(sp, 1)} className={wide ? 'text-warn' : undefined} />
              </div>
            ) : (
              <div className="mt-1 text-[11.5px] text-fg-3">At {price(spot)} a share unless you change the cost below.</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
