import { SCAN_DAYS_BACK, TAKE_PROFIT_LEFT } from '@shared/defaults'
import type { ExitRow } from '@shared/types'
import { cn } from '../../lib/cn'
import { fmtDate, pct, price } from '../../lib/format'
import { EXIT_TODO } from '../../lib/signals'
import { ExitBadge, ExitLegend } from '../ExitBadge'
import { LevelBadge } from '../LevelBadge'
import { Tip } from '../Tip'

interface ExitsListProps {
  exits: ExitRow[]
  loading: boolean
  /** false = the run saved no exits file, so "no exits" would be a guess. */
  saved: boolean
  selected: string | null
  onSelect: (e: ExitRow) => void
}

function ago(days: number): string {
  return days <= 0 ? 'today' : `${days}d ago`
}

function ExitItem({ e, on, onSelect }: { e: ExitRow; on: boolean; onSelect: (e: ExitRow) => void }): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(e)}
        className={cn(
          'ring-focus grid h-11 w-full grid-cols-[76px_86px_82px_62px_50px_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 text-left transition-colors',
          on ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <LevelBadge level={e.level} size="sm" />
          <span className="truncate text-[13px] font-semibold tracking-tight">{e.ticker}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <ExitBadge tag={e.tag} />
        </span>
        <span className={cn('num whitespace-nowrap text-[12px]', e.forming ? 'font-medium text-warn' : e.daysAgo <= 0 ? 'font-medium text-fg' : 'text-fg-2')}>
          {e.forming ? 'Forming' : e.daysAgo <= 0 ? 'Today' : `${fmtDate(e.date)}, ${ago(e.daysAgo)}`}
        </span>
        <Tip content={`Entered ${fmtDate(e.enter)} at ${price(e.enterPrice)}`}>
          <span className="num text-right text-[12px] text-fg">{price(e.price)}</span>
        </Tip>
        <span className={cn('num text-right text-[12px] font-medium', e.move >= 0 ? 'text-profit' : 'text-loss')}>{pct(e.move, 1, true)}</span>
        <span className="flex min-w-0 items-center pl-1">
          <span
            className="truncate text-[12px] text-fg-2"
            title={`${EXIT_TODO[e.tag]}${e.forming ? '. Forming today: final at the close.' : ''}`}
          >
            {EXIT_TODO[e.tag]}
          </span>
        </span>
      </button>
    </li>
  )
}

export function ExitsList({ exits, loading, saved, selected, onSelect }: ExitsListProps): React.JSX.Element {
  const empty = !loading && exits.length === 0
  const emptyText = saved
    ? `No exits in the last ${SCAN_DAYS_BACK} trading days.`
    : 'This scan saved no exits file (signals_exits_*.csv). Your scanner may not write one.'
  return (
    <section aria-label="Exits" className={cn('flex min-h-0 flex-col', !empty && 'flex-1')}>
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <h2 className="text-[13.5px] font-semibold tracking-tight">Exits</h2>
        {!loading && <span className="num rounded-md bg-white/[0.06] px-1.5 text-[11px] leading-[18px] text-fg-2">{exits.length}</span>}
        {empty ? (
          <span className="min-w-0 text-[11.5px] leading-snug text-fg-3">{emptyText}</span>
        ) : (
          <>
            <span className="truncate text-[11.5px] text-fg-3">Exit signals from your scanner</span>
            <div className="ml-auto shrink-0">
              <ExitLegend />
            </div>
          </>
        )}
      </div>
      {empty ? (
        <div className="pb-2" />
      ) : (
        <>
          <p className="px-4 pb-2 text-[11.5px] text-fg-3">
            Each exit refers to a position entered on the ENTER date. Selling puts? Keep your {Math.round(TAKE_PROFIT_LEFT * 100)}% buy-back order.
          </p>
          {loading ? (
            <div className="flex flex-col gap-3 px-4 py-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-3" style={{ width: `${80 - i * 18}%` }} />
              ))}
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {exits.map((e) => (
                <ExitItem key={`${e.ticker}-${e.date}-${e.tag}`} e={e} on={selected === `${e.ticker}|exit`} onSelect={onSelect} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
