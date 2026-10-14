import type { Level, Tested } from '@shared/types'
import type { Stats } from '@shared/calc'
import { TAKE_PROFIT_LEFT } from '../../lib/calcRequest'
import { fmtDate, money, pct, price, strike as fmtStrike } from '../../lib/format'
import type { Built, Strategy, TakeProfit } from '../../lib/position'
import { StatTile } from '../StatTile'
import { TweenNumber } from '../TweenNumber'

interface StatsGridProps {
  stats: Stats
  strategy: Strategy
  built: Built
  ticker: string
  spot: number
  expiry: string
  takeProfit: TakeProfit | null
  /** The signal level's optional backtest results from the scan file (null for a typed ticker or when not written). */
  tested: Tested | null
  level: Level | null
}

const usd = (n: number): string => money(n)
const usdSigned = (n: number): string => money(n, { sign: true })
const pct0 = (n: number): string => pct(n, 0)
const pct1 = (n: number): string => pct(n, 1)

function lossWhere(strategy: Strategy, built: Built, ticker: string): string {
  if (strategy === 'csp' || strategy === 'covered_call') return `if ${ticker} hits $0`
  return `under $${fmtStrike(Math.min(...built.strikes))}`
}

const CASH_NOTE: Record<Strategy, string> = {
  csp: 'strike × 100',
  put_credit_spread: 'width − collected',
  long_call: 'what you pay',
  covered_call: 'the 100 shares'
}

/** The backtest numbers that match this trade type: puts for a cash-secured put, spreads for a put credit spread. */
function testedFor(strategy: Strategy, t: Tested | null): { won: number | null; avg: number | null; badAtBidAsk: boolean } | null {
  if (!t) return null
  if (strategy === 'csp' && t.putWon != null) return { won: t.putWon, avg: t.putAvg, badAtBidAsk: false }
  if (strategy === 'put_credit_spread' && t.spreadWon != null) {
    return { won: t.spreadWon, avg: t.spreadMid, badAtBidAsk: t.spreadNatural != null && t.spreadNatural < 0 }
  }
  return null
}

/** The odds tile's sub-line: the level's backtest record when the scanner wrote one, else what the number is. */
function OddsSub({ t, level }: { t: ReturnType<typeof testedFor>; level: Level | null }): React.JSX.Element {
  if (!t || t.won == null) return <>market's odds at expiry</>
  return (
    <span className="whitespace-normal">
      Scanner backtest{level ? ` (level ${level}/3)` : ''}: <span className="num text-fg-2">{pct(t.won, 0)}</span> won
      {t.avg != null && <>, avg <span className="num text-fg-2">{pct(t.avg, 1)}</span> of cash</>}
    </span>
  )
}

function TakeProfitTile({ tp }: { tp: TakeProfit | null }): React.JSX.Element {
  return (
    <StatTile
      label={`${Math.round(TAKE_PROFIT_LEFT * 100)}% buy-back`}
      tone={tp ? 'profit' : 'neutral'}
      value={tp ? <TweenNumber value={tp.profit} format={usdSigned} /> : '—'}
      sub={tp ? `Buy back at ${price(tp.buyBack)}, good till canceled` : 'nothing collected to buy back'}
    />
  )
}

export function StatsGrid({ stats, strategy, built, ticker, spot, expiry, takeProfit, tested, level }: StatsGridProps): React.JSX.Element {
  const be = stats.breakevens[0]
  const alwaysUp = stats.maxLoss !== 'unlimited' && stats.maxLoss >= 0
  const maxDown = stats.maxProfit !== 'unlimited' && Math.round(stats.maxProfit) < 0
  const t = testedFor(strategy, tested)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-2">
        <StatTile
          label="Max profit"
          tone={maxDown ? 'loss' : 'profit'}
          value={stats.maxProfit === 'unlimited' ? 'Unlimited' : <TweenNumber value={stats.maxProfit} format={usdSigned} />}
          sub={stats.maxProfit === 'unlimited' ? 'no cap' : maxDown ? 'a loss even if called away' : `above $${fmtStrike(Math.max(...built.strikes))}`}
        />
        <StatTile
          label="Max loss"
          tone="loss"
          value={stats.maxLoss === 'unlimited' ? 'Unlimited' : <TweenNumber value={stats.maxLoss} format={usd} />}
          sub={lossWhere(strategy, built, ticker)}
        />
        <StatTile
          label="Breakeven"
          value={be != null ? <TweenNumber value={be} format={price} /> : 'None'}
          sub={be != null ? `${pct(be / spot - 1, 1, true)} from now` : alwaysUp ? 'profit at any price' : 'never profitable'}
        />
        <StatTile
          label="Market's odds (model)"
          value={stats.chanceOfProfit != null ? <TweenNumber value={stats.chanceOfProfit} format={pct0} /> : '—'}
          meter={stats.chanceOfProfit}
          sub={<OddsSub t={t} level={level} />}
        />
        <StatTile label="Cash needed" value={<TweenNumber value={stats.cash} format={usd} />} sub={CASH_NOTE[strategy]} />
        {strategy === 'long_call' ? (
          <>
            <StatTile label="Worth if used today" value={<TweenNumber value={stats.intrinsic ?? 0} format={price} />} sub="per share (intrinsic)" />
            <StatTile label="Time value" value={<TweenNumber value={stats.extrinsic ?? 0} format={price} />} sub="per share, melts by expiry" />
          </>
        ) : (
          <>
            <StatTile
              label="Return on cash"
              tone={stats.returnOnCash == null ? 'neutral' : Math.round(stats.returnOnCash * 1000) < 0 ? 'loss' : 'profit'}
              value={stats.returnOnCash != null ? <TweenNumber value={stats.returnOnCash} format={pct1} /> : '—'}
              sub={strategy === 'covered_call' ? 'if the stock stays flat' : 'if held to expiry'}
            />
            <TakeProfitTile tp={takeProfit} />
          </>
        )}
        <StatTile label="Days left" value={<TweenNumber value={stats.daysToExpiry} format={(n) => String(Math.round(n))} />} sub={fmtDate(expiry, new Date().getFullYear())} />
      </div>
      {t?.badAtBidAsk && (
        <p className="text-[12px] text-warn">In the scanner's backtest at bid/ask prices this spread lost money. Use a limit order at the mid.</p>
      )}
    </div>
  )
}
