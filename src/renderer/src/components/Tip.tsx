import { Tooltip } from 'radix-ui'
import type { ReactNode } from 'react'

interface TipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

/** A small dark tooltip. The child must accept a ref (a DOM element or a forwardRef component). */
export function Tip({ content, children, side = 'top', align = 'center' }: TipProps): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={10}
          className="z-50 max-w-[280px] rounded-lg border border-line-2 bg-[#11141c]/95 px-2.5 py-1.5 text-[12px] leading-snug text-fg shadow-[0_12px_32px_-8px_rgb(0_0_0/0.8)] backdrop-blur-md"
        >
          {content}
          <Tooltip.Arrow className="fill-[#11141c]" width={10} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
