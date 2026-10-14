import { TAKE_PROFIT_LEFT } from '@shared/defaults'
import type { Signal } from '@shared/types'
import { ArrowDown, ArrowUp, Eye } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { SortKey, SortState } from '../../lib/signals'
import type { PriceSource } from './SignalCells'
import { SignalRow, type DateMode } from './SignalRow'

interface Column {
  key: string
  label: string
  sort: SortKey | null
  width: number
  align: 'left' | 'right'
  title: string
}

const COLUMNS: Column[] = [
  { key: 'signal', label: 'Signal', sort: 'level', width: 146, align: 'left', title: 'Level, then newest first' },
  { key: 'price', label: 'Price', sort: 'move', width: 60, align: 'right', title: 'Price now and the move since the signal' },
  { key: 'put', label: 'Put', sort: 'put', width: 128, align: 'left', title: `The put to sell, its mid price, and the good-till-canceled buy-back price (${Math.round(TAKE_PROFIT_LEFT * 100)}% of what the spread collects)` },
  { key: 'collect', label: 'Collect', sort: 'collect', width: 76, align: 'right', title: 'What 1 put credit spread collects at the mids, and the most it can lose (a put without a wing: the cash it ties up)' },
  { key: 'spread', label: 'Spread', sort: 'spread', width: 44, align: 'right', title: 'Bid / ask gap as a share of the mid' },
  { key: 'won', label: 'Won', sort: 'won', width: 74, align: 'right', title: "How often this stock's put won at this level, and how many trades that rests on" },
  { key: 'earn', label: 'Earnings', sort: 'earn', width: 56, align: 'left', title: 'Next earnings report' },
  { key: 'calc', label: '', sort: null, width: 32, align: 'right', title: '' }
]
const TOTAL = COLUMNS.reduce((s, c) => s + c.width, 0)

interface SignalsTableProps {
  dateMode: DateMode
  rows: Signal[]
  nearRows: Signal[]
  src: PriceSource
  sort: SortState
  onSort: (key: SortKey) => void
  selected: string | null
  onSelect: (s: Signal) => void
  onCalculate: (s: Signal) => void
  revision: number
}

function HeaderCell({ c, sort, onSort }: { c: Column; sort: SortState; onSort: (k: SortKey) => void }): React.JSX.Element {
  const active = c.sort != null && sort.key === c.sort
  const Arrow = sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('h-8 px-1.5 font-normal first:pl-2.5', c.align === 'right' ? 'text-right' : 'text-left')}
    >
      {c.sort && (
        <button
          type="button"
          title={c.title}
          onClick={() => onSort(c.sort as SortKey)}
          className={cn(
            'ring-focus inline-flex items-center gap-1 rounded text-[11.5px] transition-colors',
            active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
            c.align === 'right' && 'flex-row-reverse'
          )}
        >
          {c.label}
          {active && <Arrow size={11} className="text-profit" />}
        </button>
      )}
    </th>
  )
}

export function SignalsTable({ dateMode, rows, nearRows, src, sort, onSort, selected, onSelect, onCalculate, revision }: SignalsTableProps): React.JSX.Element {
  const isSelected = (s: Signal): boolean => selected === `${s.ticker}|${s.kind}`
  return (
    <table className="w-full table-fixed border-separate border-spacing-0">
      <colgroup>
        {COLUMNS.map((c) => (
          <col key={c.key} style={{ width: `${(c.width / TOTAL) * 100}%` }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-10 bg-[#0a0c12]/90 backdrop-blur-md">
        <tr className="[&>th]:border-b [&>th]:border-line">
          {COLUMNS.map((c) => (
            <HeaderCell key={c.key} c={c} sort={sort} onSort={onSort} />
          ))}
        </tr>
      </thead>
      <tbody key={`main-${revision}`}>
        {rows.map((s, i) => (
          <SignalRow key={`${s.ticker}-${s.kind}-${s.date}`} s={s} src={src} dateMode={dateMode} index={i} selected={isSelected(s)} onSelect={onSelect} onCalculate={onCalculate} />
        ))}
      </tbody>
      {nearRows.length > 0 && (
        <tbody key={`near-${revision}`}>
          <tr>
            <td colSpan={COLUMNS.length} className="px-3 pb-2 pt-5">
              <div className="flex items-center gap-2">
                <Eye size={13} className="text-warn" />
                <span className="text-[12.5px] font-semibold text-fg">Check the chart</span>
                <span className="text-[11.5px] text-fg-3">One rule just missed. Look at the chart before you trade.</span>
              </div>
            </td>
          </tr>
          {nearRows.map((s, i) => (
            <SignalRow key={`${s.ticker}-near-${s.date}`} s={s} src={src} dateMode={dateMode} index={rows.length + i} selected={isSelected(s)} onSelect={onSelect} onCalculate={onCalculate} />
          ))}
        </tbody>
      )}
    </table>
  )
}

export function signalKey(s: Signal): string {
  return `${s.ticker}|${s.kind}`
}

export function TableSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-[22px] w-[34px]" />
          <div className="skeleton h-3 w-16" />
          <div className="skeleton ml-auto h-3 w-[55%]" style={{ opacity: 1 - i * 0.12 }} />
        </div>
      ))}
    </div>
  )
}
