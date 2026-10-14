import type { Signal } from '@shared/types'
import { Calculator, Eye } from 'lucide-react'
import { motion } from 'motion/react'
import type { KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'
import { daysBetween, fmtDate, money, pct, price } from '../../lib/format'
import { hasLiveQuote, moveSince, needsChartCheck } from '../../lib/signals'
import { nyToday } from '../../lib/time'
import { LevelBadge } from '../LevelBadge'
import { Tip } from '../Tip'
import { CollectCell, PutCell, SpreadCell, Stack, WonCell, type PriceSource } from './SignalCells'

const LEVEL_BAR = { 3: '#00e676', 2: '#00c853', 1: '#69f0ae' } as const

/** $778.59, but $1,325 above $1,000 so the narrow Price column never cuts it off. */
function cellPrice(n: number): string {
  return n >= 1000 ? money(n) : price(n)
}

/**
 * How a row says when it fired. 'relative' = "Today" / "3d ago"; 'today' = the date instead of "Today" (scan ran before the
 * open or after the close); 'all' = dates on every row (the scan is not from today, so "3d ago" would be wrong).
 */
export type DateMode = 'relative' | 'today' | 'all'

function dayText(s: Signal, mode: DateMode): string {
  if (mode === 'all' || (mode === 'today' && s.daysAgo <= 0)) return fmtDate(s.date)
  return s.daysAgo <= 0 ? 'Today' : `${s.daysAgo}d ago`
}

export function whenText(s: Signal, mode: DateMode = 'relative'): string {
  const dated = mode !== 'relative'
  if (s.kind === 'near') return dated ? `Near miss ${fmtDate(s.date)}` : 'Near miss today'
  if (s.kind === 'forming') return dated ? `Forming ${fmtDate(s.date)}` : 'Forming today'
  return dayText(s, mode)
}

interface SignalRowProps {
  s: Signal
  /** Where the put prices come from. */
  src: PriceSource
  index: number
  selected: boolean
  dateMode: DateMode
  onSelect: (s: Signal) => void
  onCalculate: (s: Signal) => void
}

/** Line 2 = what to do or the day; line 3 = the day under "Check chart". */
function signalLines(s: Signal, mode: DateMode): { status: string; sub: string | null } {
  const day = s.kind === 'near' ? 'Near miss' : s.kind === 'forming' ? 'Forming' : dayText(s, mode)
  if (needsChartCheck(s)) return { status: 'Check chart', sub: day }
  return { status: day, sub: null }
}

function SignalCell({ s, dateMode }: { s: Signal; dateMode: DateMode }): React.JSX.Element {
  const check = needsChartCheck(s)
  const when = whenText(s, dateMode)
  const lines = signalLines(s, dateMode)
  const cell = (
    <div tabIndex={check || s.kind === 'forming' ? 0 : undefined} className="flex min-w-0 items-center gap-1.5">
      <LevelBadge level={s.level} />
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="flex min-w-0 items-center gap-1">
          <span className="shrink-0 text-[13.5px] font-semibold leading-none tracking-tight text-fg">{s.ticker}</span>
          {check && <Eye size={12} className="shrink-0 text-warn" aria-hidden="true" />}
        </div>
        <div className={cn('truncate text-[11px] leading-none', check ? 'text-warn' : s.kind === 'forming' ? 'text-fg-2' : 'text-fg-3')}>
          {lines.status}
        </div>
        {lines.sub && <span className="num truncate text-[11px] leading-none text-fg-3">{lines.sub}</span>}
      </div>
    </div>
  )
  if (check) {
    const tip = `${s.detail ?? 'Right at the edge of a rule'}. ${when}.${s.kind === 'forming' ? ' Final at the close.' : ''}`
    return <Tip content={tip} side="top" align="start">{cell}</Tip>
  }
  if (s.kind === 'forming') return <Tip content={`Forming: the signal is final at the close. ${when}.`} side="top" align="start">{cell}</Tip>
  return cell
}

function EarnCell({ s }: { s: Signal }): React.JSX.Element {
  if (!s.nextEarn) return <span className="text-fg-3">—</span>
  const earnDays = daysBetween(nyToday(), s.nextEarn)
  const earnFirst = s.put != null && s.nextEarn <= s.put.expiry
  return (
    <Tip content={earnFirst ? 'Earnings come before the put expires.' : 'Next earnings report.'} align="end">
      <div tabIndex={0}>
        <Stack
          align="left"
          top={fmtDate(s.nextEarn)}
          rest={[<span key="e" className={earnFirst ? 'text-warn' : undefined}>{earnDays >= 0 ? `in ${earnDays}d` : 'passed'}</span>]}
        />
      </div>
    </Tip>
  )
}

export function SignalRow({ s, src, index, selected, dateMode, onSelect, onCalculate }: SignalRowProps): React.JSX.Element {
  const move = moveSince(s)
  const live = hasLiveQuote(s.put)
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(s)
    }
  }
  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.4), ease: [0.16, 1, 0.3, 1] }}
      tabIndex={0}
      aria-selected={selected}
      onClick={() => onSelect(s)}
      onKeyDown={onKey}
      className={cn(
        'ring-focus group h-[58px] cursor-pointer border-b border-white/[0.04] outline-offset-[-2px] transition-colors duration-150 [&>td]:px-1.5',
        selected ? 'bg-white/[0.055]' : 'hover:bg-white/[0.03]'
      )}
      style={selected ? { boxShadow: `inset 3px 0 0 ${LEVEL_BAR[s.level]}`, backgroundImage: `linear-gradient(90deg, ${LEVEL_BAR[s.level]}1f, transparent 45%)` } : undefined}
    >
      <td className="pl-2.5!">
        <SignalCell s={s} dateMode={dateMode} />
      </td>
      <td>
        <Tip content={`Then ${price(s.priceThen)}, now ${price(s.priceNow)}`}>
          <div tabIndex={0}>
            <Stack top={cellPrice(s.priceNow)} rest={[<span key="m" className={move >= 0 ? 'text-profit' : 'text-loss'}>{pct(move, 1, true)}</span>]} />
          </div>
        </Tip>
      </td>
      <td>
        <PutCell s={s} src={src} />
      </td>
      <td>
        <CollectCell s={s} />
      </td>
      <td>
        <SpreadCell s={s} />
      </td>
      <td>
        <WonCell s={s} />
      </td>
      <td>
        <EarnCell s={s} />
      </td>
      <td className="text-right">
        <Tip content={live ? 'Open this put credit spread in the calculator' : 'Open a put credit spread in the calculator: no live quote, so it picks fresh strikes from live prices'} align="end">
          <button
            type="button"
            aria-label={`Calculate ${s.ticker}`}
            onClick={(e) => {
              e.stopPropagation()
              onCalculate(s)
            }}
            className="ring-focus inline-grid size-6 place-items-center rounded-lg border border-line bg-white/[0.03] text-fg-2 transition-colors hover:border-profit/50 hover:bg-profit/15 hover:text-profit"
          >
            <Calculator size={13} />
          </button>
        </Tip>
      </td>
    </motion.tr>
  )
}
