import { cn } from '../lib/cn'
import { marketStatus } from '../lib/time'
import { useNow } from '../lib/useClock'
import { Logo } from './Logo'

function useMinuteClock(): Date {
  return new Date(useNow(15_000))
}

/**
 * The 36 px strip at the top drags the window. Nothing in it is clickable, and the right ~140 px stay empty for
 * the window buttons Electron draws there (titleBarStyle hidden + overlay).
 */
export function TitleBar(): React.JSX.Element {
  const status = marketStatus(useMinuteClock())
  return (
    <header className="drag relative flex h-9 shrink-0 select-none items-center pr-[150px]">
      <div className="flex w-[84px] items-center justify-center">
        <Logo size={20} />
      </div>
      <div className="text-[12.5px] font-semibold tracking-tight text-fg">Options Desk</div>
      <div className="ml-auto flex items-center gap-3 text-[11.5px] text-fg-3">
        <span className="inline-flex items-center gap-2">
          <span
            className={cn('size-[7px] rounded-full', status.open ? 'animate-pulse-dot bg-profit' : 'bg-fg-4')}
            aria-hidden="true"
          />
          {status.label}
        </span>
        <span className="num text-fg-2">{status.clock}</span>
      </div>
    </header>
  )
}
