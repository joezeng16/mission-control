/** The money cells of a signal row: the put, what the spread collects, the bid/ask gap and the win rate. */
import { LEVEL_DELTA, TAKE_PROFIT_LEFT } from '@shared/defaults'
import type { PutQuote, Signal } from '@shared/types'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { compactMoney, dec2, fmtDate, money, pct, price, strike } from '../../lib/format'
import { MIN_TRADES, cashPerContract, collectPerContract, hasLiveQuote, isWide, plainPutNote, rowBuyback, spreadOf, testedText, wonView } from '../../lib/signals'
import { Tip } from '../Tip'

/** Where the rows' put prices come from: the scan file, priced when the scan ran. */
export interface PriceSource {
  /** "10:03 AM ET": when the scan ran. */
  scanTime: string
}

interface StackProps {
  top: ReactNode
  rest?: ReactNode[]
  align?: 'left' | 'right'
  muted?: boolean
}

/** One bold-ish top line and up to two small lines under it. */
export function Stack({ top, rest = [], align = 'right', muted = false }: StackProps): React.JSX.Element {
  const side = align === 'right' ? 'text-right' : 'text-left'
  return (
    <div className={cn('flex min-w-0 flex-col gap-[3px]', align === 'right' ? 'items-end' : 'items-start')}>
      <div className={cn('num w-full truncate text-[13px] leading-none', muted ? 'text-fg-3' : 'text-fg', side)}>{top}</div>
      {rest.map((line, i) => (
        <div key={i} className={cn('num w-full truncate text-[11px] leading-none text-fg-3', side)}>
          {line}
        </div>
      ))}
    </div>
  )
}

function Tag({ children, tone }: { children: ReactNode; tone: 'warn' | 'grey' }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-block rounded-[4px] px-1 text-[9.5px] font-semibold uppercase leading-[13px] tracking-wide',
        tone === 'warn' ? 'bg-warn/15 text-warn' : 'bg-white/[0.07] text-fg-3'
      )}
    >
      {children}
    </span>
  )
}

const TP_PCT = `${Math.round(TAKE_PROFIT_LEFT * 100)}%`

function BuybackLine({ buyback }: { buyback: number | null }): React.JSX.Element {
  return (
    <span className="text-fg-2">
      Buy back at {buyback != null ? `$${dec2(buyback)}` : '—'}
      <span className="hidden @min-[130px]:inline"> ({TP_PCT})</span>
    </span>
  )
}

function buybackTip(p: PutQuote): string {
  const s = spreadOf(p)
  const bb = rowBuyback(p)
  if (bb == null) return ''
  return s
    ? ` Your take-profit rule: a good-till-canceled order to buy the spread back at $${dec2(bb)}, ${TP_PCT} of the $${dec2(s.credit)} it collects.`
    : ` Your take-profit rule: a good-till-canceled order to buy the put back at $${dec2(bb)}, ${TP_PCT} of what it collects.`
}

function tradeWords(p: PutQuote): string {
  const s = spreadOf(p)
  const sell = `Sell the ${fmtDate(p.expiry)} $${strike(p.strike)} put`
  return s ? `${sell}, buy the $${strike(s.wingStrike)} put (spread collects about $${dec2(s.credit)} a share at the mids).` : `${sell}.`
}

/** The put cell's tooltip for a live price: the trade, bid/ask/mid, delta vs the level's default aim. */
export function putTip(s: Signal, p: PutQuote, src: PriceSource): string {
  const delta = p.delta != null ? ` Delta ${Math.abs(p.delta).toFixed(2)} (the ${s.level}/3 default aims for ${LEVEL_DELTA[s.level].toFixed(2)}).` : ''
  const wide = isWide(p.spreadPct) ? ' Wide gap between bid and ask: use a limit near the mid.' : ''
  return `From the scan (${src.scanTime}). ${tradeWords(p)} Sold put: bid ${dec2(p.bid)}, ask ${dec2(p.ask)}, mid ${dec2(p.mid)}.${delta}${wide}${buybackTip(p)}`
}

/** Strike and expiry, the sold put's mid, and the good-till-canceled buy-back. */
export function PutCell({ s, src }: { s: Signal; src: PriceSource }): React.JSX.Element {
  const p = s.put
  if (!p) {
    return (
      <Tip content="The scanner found no put for this stock. Calculate picks one from live prices.">
        <span tabIndex={0} className="text-[11.5px] text-fg-3">No put found</span>
      </Tip>
    )
  }
  const head = (
    <>
      ${strike(p.strike)} <span className="text-[11px] text-fg-3">{fmtDate(p.expiry)}</span>
    </>
  )
  if (!hasLiveQuote(p)) {
    const tip = `${plainPutNote(p)} Last trade ${dec2(p.mid)}. The strike was picked from that price; Calculate picks a fresh one.`
    return (
      <Tip content={tip}>
        <div tabIndex={0} className="@container">
          <Stack align="left" muted top={head} rest={[<Tag key="t" tone="grey">no quote</Tag>, `last trade ${dec2(p.mid)}`]} />
        </div>
      </Tip>
    )
  }
  const midLine = (
    <span key="m" className="inline-flex items-center gap-1">
      <span>mid {dec2(p.mid)}</span>
      <span className="hidden text-fg-3 @min-[160px]:inline">
        · {dec2(p.bid)}/{dec2(p.ask)}
      </span>
    </span>
  )
  return (
    <Tip content={putTip(s, p, src)}>
      <div tabIndex={0} className="@container">
        <Stack align="left" top={head} rest={[midLine, <BuybackLine key="b" buyback={rowBuyback(p)} />]} />
      </div>
    </Tip>
  )
}

function collectTip(s: Signal): string {
  const p = s.put
  const sp = spreadOf(p)
  if (sp && p) {
    return `Spread: ${price(sp.credit)} collected · risk ${money(sp.risk)} for 1 contract (sell the $${strike(p.strike)} put, buy the $${strike(sp.wingStrike)} put, at the mids).`
  }
  const collect = collectPerContract(s)
  const cash = cashPerContract(s)
  const wing = p?.wingStrike != null ? ' The scan had no price for the bought put, so this is the sold put alone.' : ''
  return `Cash-secured put: ${collect != null ? money(collect) : '—'} collected for 1 contract at the mid${cash != null ? `, ties up ${money(cash)}` : ''}.${wing}`
}

/** What one spread collects at the mid and what it can lose (else one cash-secured put and the cash it ties up). Grey when
 *  the price is a last trade. */
export function CollectCell({ s }: { s: Signal }): React.JSX.Element {
  const sp = spreadOf(s.put)
  const collect = sp?.collect ?? collectPerContract(s)
  if (collect == null) return <Stack top="—" muted />
  const muted = !hasLiveQuote(s.put)
  const cash = cashPerContract(s)
  const sub = sp ? `risk ${compactMoney(sp.risk)}` : cash != null ? `ties up ${compactMoney(cash)}` : null
  return (
    <Tip content={collectTip(s)} align="end">
      <div tabIndex={0}>
        <Stack muted={muted} top={<span className={muted ? undefined : 'font-medium text-profit'}>{money(collect)}</span>} rest={sub ? [sub] : []} />
      </div>
    </Tip>
  )
}

/** Bid/ask gap as a share of the mid; "no quote" when the scan had no live bid and ask. */
export function SpreadCell({ s }: { s: Signal }): React.JSX.Element {
  const p = s.put
  if (!p || !hasLiveQuote(p)) {
    return (
      <Tip content="No live bid and ask when the scan ran, so there is no gap to show.">
        <span tabIndex={0} className="block whitespace-nowrap text-right text-[11px] text-fg-3">no quote</span>
      </Tip>
    )
  }
  if (!isWide(p.spreadPct)) return <Stack top={pct(p.spreadPct)} rest={['ok']} />
  return (
    <Tip content="Wide gap between bid and ask. Use a limit order near the mid.">
      <div tabIndex={0}>
        <Stack top={pct(p.spreadPct)} rest={[<Tag key="w" tone="warn">wide</Tag>]} />
      </div>
    </Tip>
  )
}

function wonTip(s: Signal): string {
  const lv = `${s.level}/3`
  const v = wonView(s)
  const own = `The scanner says this stock's ${lv} signal won ${v.rate} of ${v.count.replace(/^only /, '')} in its history.`
  const few = v.few ? ` Under ${MIN_TRADES} trades is too few to lean on.` : ''
  const t = s.tested
  const all = testedText(t) && t ? ` Every ${lv} signal in the scanner's backtest: ${pct(t.putWon)} won, avg ${pct(t.putAvg, 1, true)} of cash a trade.` : ''
  return `${own}${few}${all}`
}

/** The stock's win rate at this level and how many trades it rests on. */
export function WonCell({ s }: { s: Signal }): React.JSX.Element {
  const v = wonView(s)
  return (
    <Tip content={wonTip(s)} align="end">
      <div tabIndex={0}>
        <Stack muted={v.few} top={v.rate} rest={[<span key="n" className={v.few ? 'text-fg-4' : undefined}>{v.count}</span>]} />
      </div>
    </Tip>
  )
}
