import { cn } from '../../lib/cn'
import { isLoss, money, pct, price } from '../../lib/format'
import { PL_COLORS } from '../../charts/plGeometry'
import { TweenNumber } from '../TweenNumber'

interface PLHeroProps {
  ticker: string
  stockPrice: number
  hovering: boolean
  expiryLabel: string
  /** The Date slider's day when it sits between today and expiry; null = today or expiry (the hero then shows expiry). */
  dateLabel: string | null
  atExpiry: number
  atDate: number
  today: number
  cash: number
  /** false = no valid position yet (loading, or a strike error): show a dash, not a made-up $0.00. */
  ready: boolean
}

const signed = (n: number): string => money(n, { decimals: 2, sign: true })

function Small({ color, label, value }: { color: string; label: string; value: number }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label} <span className={cn('num font-medium', isLoss(value) ? 'text-loss' : 'text-profit')}>{money(value, { sign: true })}</span>
    </span>
  )
}

const BIG = 'num mt-1 text-[50px] font-semibold leading-[1.02] tracking-[-0.045em]'

function Numbers({ big, hovering, dateLabel, expiryLabel, atExpiry, today, cash }: {
  big: number; hovering: boolean; dateLabel: string | null; expiryLabel: string; atExpiry: number; today: number; cash: number
}): React.JSX.Element {
  const down = isLoss(big, 2)
  return (
    <>
      <div
        className={cn(BIG, down ? 'text-loss' : 'text-profit')}
        style={{ textShadow: `0 0 36px ${down ? 'rgb(255 80 0 / 0.3)' : 'rgb(0 200 5 / 0.35)'}`, fontFamily: 'var(--font-sans)' }}
        aria-live="polite"
      >
        <TweenNumber value={big} format={signed} instant={hovering} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-3">
        {cash > 0 && (
          <span>
            <span className={cn('num font-medium', Math.round((big / cash) * 1000) < 0 ? 'text-loss' : 'text-profit')}>{pct(big / cash, 1, true)}</span> of {money(cash)} cash
          </span>
        )}
        {dateLabel && <Small color={PL_COLORS.profit} label={`At expiry (${expiryLabel})`} value={atExpiry} />}
        <Small color={PL_COLORS.today} label="Today" value={today} />
      </div>
    </>
  )
}

/** The big P/L number. It follows the Date slider: P/L on the slider's day when it is moved between today and
 *  expiry, else P/L at expiry; at the cursor, or at today's price. */
export function PLHero({ ticker, stockPrice, hovering, expiryLabel, dateLabel, atExpiry, atDate, today, cash, ready }: PLHeroProps): React.JSX.Element {
  const when = dateLabel ? `on ${dateLabel}` : `${hovering ? 'on' : 'until'} ${expiryLabel}`
  return (
    <div className="min-w-0">
      <p className="truncate text-[12.5px] text-fg-3">
        If {ticker} {hovering ? 'is' : 'stays'} at <span className="num text-fg-2">{price(stockPrice)}</span> {when}
      </p>
      {ready ? (
        <Numbers
          big={dateLabel ? atDate : atExpiry}
          hovering={hovering}
          dateLabel={dateLabel}
          expiryLabel={expiryLabel}
          atExpiry={atExpiry}
          today={today}
          cash={cash}
        />
      ) : (
        <div className={cn(BIG, 'text-fg-4')} style={{ fontFamily: 'var(--font-sans)' }}>—</div>
      )}
    </div>
  )
}
