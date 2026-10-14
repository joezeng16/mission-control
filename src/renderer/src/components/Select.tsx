import { Check, ChevronDown } from 'lucide-react'
import { Select as RS } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface SelectOption {
  value: string
  label: string
  hint?: ReactNode
}

interface SelectProps {
  value: string | null
  onChange: (value: string) => void
  options: SelectOption[]
  label: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

/** Dark dropdown (Radix Select). Hints show in the list only, not in the closed box. */
export function Select({ value, onChange, options, label, placeholder = 'Pick one', disabled, className }: SelectProps): React.JSX.Element {
  return (
    <RS.Root value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <RS.Trigger
        aria-label={label}
        className={cn(
          'ring-focus num flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-black/30 px-3 text-left text-[13px] text-fg transition-colors hover:border-line-2 disabled:opacity-50 data-[placeholder]:text-fg-3',
          className
        )}
      >
        <span className="truncate">
          <RS.Value placeholder={placeholder} />
        </span>
        <RS.Icon>
          <ChevronDown size={14} className="text-fg-3" />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-line-2 bg-[#0e1118]/95 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.9)] backdrop-blur-xl"
        >
          <RS.ScrollUpButton className="grid h-6 place-items-center text-fg-3">
            <ChevronDown size={12} className="rotate-180" />
          </RS.ScrollUpButton>
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                className="num relative flex h-8 cursor-default select-none items-center gap-3 rounded-md pl-7 pr-2.5 text-[12.5px] text-fg-2 outline-none data-[highlighted]:bg-white/[0.07] data-[highlighted]:text-fg data-[state=checked]:text-fg"
              >
                <RS.ItemIndicator className="absolute left-2 text-profit">
                  <Check size={13} />
                </RS.ItemIndicator>
                <RS.ItemText>{o.label}</RS.ItemText>
                {o.hint && <span className="ml-auto text-[11px] text-fg-3">{o.hint}</span>}
              </RS.Item>
            ))}
          </RS.Viewport>
          <RS.ScrollDownButton className="grid h-6 place-items-center text-fg-3">
            <ChevronDown size={12} />
          </RS.ScrollDownButton>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  )
}
