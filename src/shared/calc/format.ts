/** Formats: $1,234 totals, $1.23 per share, "+"/"-" signs, 1-decimal %, whole-% chances. */
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const twoDp = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const sign = (x: number, rounded: number): string => (rounded === 0 ? '' : x < 0 ? '-' : '+')

/** "$7,500" (a loss keeps its "-": "-$7,348"). */
export function money(x: number): string {
  const r = Math.round(Math.abs(x))
  return `${x < 0 && r !== 0 ? '-' : ''}$${whole.format(r)}`
}

/** "+$152", "-$7,348", "$0". */
export function signedMoney(x: number): string {
  const r = Math.round(Math.abs(x))
  return `${sign(x, r)}$${whole.format(r)}`
}

/** "$1.52" per share. */
export function perShare(x: number): string {
  return `${x < 0 ? '-' : ''}$${twoDp.format(Math.abs(x))}`
}

/** 0.0203 -> "2.0%". */
export function percent(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

/** -0.0583 -> "-5.8%", 0.099 -> "+9.9%". */
export function signedPercent(x: number): string {
  const r = Math.round(Math.abs(x) * 1000) / 10
  return `${sign(x, r)}${r.toFixed(1)}%`
}

/** 0.7612 -> "76%". */
export function chancePct(x: number): string {
  return `${Math.round(x * 100)}%`
}
