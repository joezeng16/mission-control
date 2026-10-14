import { useId } from 'react'

/** Mission Control mark: a green crescent with a rising spark. */
export function Logo({ size = 22 }: { size?: number }): React.JSX.Element {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '')
  const grad = `lg${raw}`
  const mask = `lm${raw}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00c805" />
          <stop offset="1" stopColor="#7dffb0" />
        </linearGradient>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          <circle cx="15.5" cy="8.5" r="7.2" fill="black" />
        </mask>
      </defs>
      <circle cx="11" cy="13" r="9" fill={`url(#${grad})`} mask={`url(#${mask})`} />
      <circle cx="18.6" cy="5.4" r="2.1" fill="#eaffef" />
    </svg>
  )
}
