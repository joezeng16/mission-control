import { Activity, Calculator, LogIn, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { isPreview } from '../lib/api'
import { cn } from '../lib/cn'
import { Tip } from './Tip'

export type TabId = 'signals' | 'calculator'

export const TABS: { id: TabId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: 'signals', label: 'Signals', icon: Activity, hint: 'Your scanner + your TradingView chart' },
  { id: 'calculator', label: 'Calculator', icon: Calculator, hint: 'Profit and loss of a trade' }
]

interface RailProps {
  active: TabId
  onChange: (id: TabId) => void
  tvSignedIn: boolean | null
  onTvSignIn: () => void
}

function TvStatus({ signedIn, onSignIn }: { signedIn: boolean | null; onSignIn: () => void }): React.JSX.Element {
  if (signedIn === false) {
    return (
      <button
        type="button"
        onClick={onSignIn}
        className="ring-focus mx-1.5 flex flex-col items-center gap-1 rounded-lg border border-warn/40 bg-warn/10 px-1.5 py-1.5 text-[10.5px] font-semibold leading-tight text-warn transition-colors hover:bg-warn/20"
      >
        <LogIn size={14} />
        Sign in to TradingView
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5">
      <span className={cn('size-1.5 rounded-full', signedIn ? 'bg-profit' : 'bg-fg-4')} />
      {signedIn ? 'TV signed in' : 'TV'}
    </span>
  )
}

export function Rail({ active, onChange, tvSignedIn, onTvSignIn }: RailProps): React.JSX.Element {
  return (
    <nav aria-label="Sections" className="flex w-[84px] shrink-0 flex-col items-center pb-3 pt-2">
      <ul className="flex flex-col gap-1.5">
        {TABS.map((t, i) => {
          const on = t.id === active
          const Icon = t.icon
          return (
            <li key={t.id}>
              <Tip content={`${t.hint} (Ctrl+${i + 1})`} side="right">
                <button
                  type="button"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => onChange(t.id)}
                  className={cn(
                    'ring-focus group relative flex h-[58px] w-[70px] flex-col items-center justify-center gap-1 rounded-xl transition-colors duration-150',
                    on ? 'text-fg' : 'text-fg-3 hover:bg-white/[0.035] hover:text-fg-2'
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="rail-active"
                      transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                      className="absolute inset-0 -z-10 rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.08] to-white/[0.02] shadow-[inset_0_1px_0_rgb(255_255_255/0.07)]"
                    >
                      <span className="absolute -left-[7px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-profit shadow-[0_0_10px_rgb(0_200_5/0.9)]" />
                    </motion.span>
                  )}
                  <Icon size={19} strokeWidth={on ? 2.1 : 1.8} className={cn('transition-colors', on && 'text-profit drop-shadow-[0_0_8px_rgb(0_200_5/0.6)]')} />
                  <span className="text-[10.5px] font-medium tracking-tight">{t.label}</span>
                </button>
              </Tip>
            </li>
          )
        })}
      </ul>
      <div className="mt-auto flex flex-col items-center gap-2 text-center text-[10px] leading-tight text-fg-3">
        <Tip side="right" content={isPreview ? 'Running in a browser with sample data. The app uses live data.' : 'Connected to your scanner and Yahoo prices.'}>
          <span tabIndex={0} className="ring-focus inline-flex items-center gap-1.5 rounded-md px-1.5 py-1">
            <span className={cn('size-1.5 rounded-full', isPreview ? 'bg-warn' : 'bg-profit')} />
            {isPreview ? 'Sample data' : 'Live data'}
          </span>
        </Tip>
        <TvStatus signedIn={tvSignedIn} onSignIn={onTvSignIn} />
      </div>
    </nav>
  )
}
