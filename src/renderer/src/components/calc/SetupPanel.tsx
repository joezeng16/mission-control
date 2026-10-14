import type { Chain, OptionContract } from '@shared/types'
import { RotateCcw } from 'lucide-react'
import { bsDelta } from '@shared/calc'
import type { Calculator } from '../../lib/useCalculator'
import { daysBetween, dec2, fmtDate, strike as fmtStrike } from '../../lib/format'
import { ivFor, mid, yearsLeft, type Picks } from '../../lib/position'
import { Select, type SelectOption } from '../Select'
import { FieldLabel, MoneyField, Stepper } from './Fields'
import { LegQuotes } from './LegQuotes'
import { QuoteSource } from './QuoteSource'
import { StrategyPicker } from './StrategyPicker'
import { TickerSearch } from './TickerSearch'

/** Each strike with its price and the odds the stock ends past it (delta, from the same IV the picker uses). */
function strikeOptions(list: OptionContract[], chain: Chain | null, today: string): SelectOption[] {
  if (!chain) return []
  const T = yearsLeft(chain.expiry, today)
  const ivOf = ivFor(chain, today)
  return list.map((c) => {
    const iv = ivOf(c)
    const odds = iv != null ? `${Math.round(Math.abs(bsDelta(c.type, chain.underlying, c.strike, T, iv)) * 100)}% odds it's hit` : ''
    return { value: String(c.strike), label: `$${fmtStrike(c.strike)}`, hint: odds ? `mid ${dec2(mid(c))} · ${odds}` : `mid ${dec2(mid(c))}` }
  })
}

function StrikeField({ label, which, list, c }: { label: string; which: keyof Picks; list: OptionContract[]; c: Calculator }): React.JSX.Element {
  const value = c.picks[which]
  return (
    <div className="min-w-0 flex-1">
      <FieldLabel>{label}</FieldLabel>
      <Select
        label={label}
        value={value != null ? String(value) : null}
        onChange={(v) => c.setPick(which, Number(v))}
        options={strikeOptions(list, c.chain, c.today)}
        disabled={!c.chain}
      />
    </div>
  )
}

export function SetupPanel({ c }: { c: Calculator }): React.JSX.Element {
  const expiryOptions: SelectOption[] = c.expirations.map((e) => {
    const d = daysBetween(c.today, e)
    return { value: e, label: fmtDate(e, Number(c.today.slice(0, 4))), hint: `${d} day${d === 1 ? '' : 's'}` }
  })
  const puts = c.chain?.puts ?? []
  const calls = c.chain?.calls ?? []
  const built = c.built
  return (
    <div className="flex flex-col gap-5">
      <TickerSearch key={c.ticker} ticker={c.ticker} quote={c.quote} loading={c.phase === 'loading'} onSubmit={(t) => void c.loadTicker(t)} />
      <div>
        <FieldLabel>Trade type</FieldLabel>
        <StrategyPicker value={c.strategy} onChange={c.setStrategy} />
      </div>
      <div>
        <FieldLabel>Expiration</FieldLabel>
        <Select label="Expiration" value={c.chain?.expiry ?? null} onChange={c.setExpiry} options={expiryOptions} disabled={expiryOptions.length === 0} />
      </div>
      <div className="flex gap-2">
        {c.strategy === 'csp' && <StrikeField label="Put strike (you sell)" which="short" list={puts} c={c} />}
        {c.strategy === 'put_credit_spread' && (
          <>
            <StrikeField label="Sell put" which="short" list={puts} c={c} />
            <StrikeField label="Buy put (wing)" which="long" list={puts} c={c} />
          </>
        )}
        {c.strategy === 'long_call' && <StrikeField label="Call strike (you buy)" which="call" list={calls} c={c} />}
        {c.strategy === 'covered_call' && <StrikeField label="Call strike (you sell)" which="call" list={calls} c={c} />}
      </div>
      <div className="flex gap-2">
        <div className="w-[118px] shrink-0">
          <FieldLabel>Contracts</FieldLabel>
          <Stepper label="contracts" value={c.contracts} onChange={c.setContracts} />
        </div>
        <div className="min-w-0 flex-1">
          <FieldLabel
            aside={
              c.fill != null && (
                <button type="button" onClick={() => c.setFill(null)} className="ring-focus inline-flex items-center gap-1 rounded text-[11px] text-profit hover:underline">
                  <RotateCcw size={10} /> Mid
                </button>
              )
            }
          >
            {built?.fillLabel ?? 'Fill price'}
          </FieldLabel>
          <MoneyField label={built?.fillLabel ?? 'Fill price'} value={c.fill ?? built?.defaultFill ?? 0} onCommit={c.setFill} suffix="/ share" />
        </div>
      </div>
      {c.strategy === 'covered_call' && (
        <div>
          <FieldLabel aside={c.shareCost != null && <button type="button" onClick={() => c.setShareCost(null)} className="ring-focus rounded text-[11px] text-profit hover:underline">Price now</button>}>
            Your share cost
          </FieldLabel>
          <MoneyField label="Your share cost" value={c.shareCost ?? c.spot} onCommit={c.setShareCost} suffix="/ share" />
        </div>
      )}
      {built ? (
        <div>
          <FieldLabel aside={c.chain && <QuoteSource />}>Quotes</FieldLabel>
          <LegQuotes legs={built.legs} spot={c.spot} />
        </div>
      ) : (
        c.chain && c.buildError && <p className="text-[12px] text-warn">{c.buildError}</p>
      )}
    </div>
  )
}
