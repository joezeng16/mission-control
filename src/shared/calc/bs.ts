/** Black-Scholes with a continuous dividend yield. Pure math, no I/O. Rates and IVs are fractions, T is years. */
export type OptionKind = 'call' | 'put'

export const DEFAULT_RATE = 0.04
export const IV_MIN = 0.01
export const IV_MAX = 5
/** A back-solved IV under this means the premium sits at intrinsic (a stale or typed price), not a real market IV. */
export const IV_FLOOR_HIT = 0.02
const IV_PRICE_TOL = 0.0005

/** Standard normal CDF (Hart / West double-precision approximation, error ~1e-14). */
export function normCdf(x: number): number {
  const a = Math.abs(x)
  if (a > 37) return x > 0 ? 1 : 0
  const e = Math.exp(-a * a / 2)
  let c: number
  if (a < 7.07106781186547) {
    let n = 3.52624965998911e-2 * a + 0.700383064443688
    n = n * a + 6.37396220353165; n = n * a + 33.912866078383; n = n * a + 112.079291497871
    n = n * a + 221.213596169931; n = n * a + 220.206867912376
    let d = 8.83883476483184e-2 * a + 1.75566716318264
    d = d * a + 16.064177579207; d = d * a + 86.7807322029461; d = d * a + 296.564248779674
    d = d * a + 637.333633378831; d = d * a + 793.826512519948; d = d * a + 440.413735824752
    c = e * n / d
  } else {
    let b = a + 0.65
    b = a + 4 / b; b = a + 3 / b; b = a + 2 / b; b = a + 1 / b
    c = e / b / 2.506628274631
  }
  return x > 0 ? 1 - c : c
}

export function normPdf(x: number): number {
  return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)
}

export function intrinsic(kind: OptionKind, S: number, K: number): number {
  return kind === 'call' ? Math.max(0, S - K) : Math.max(0, K - S)
}

function d1d2(S: number, K: number, T: number, iv: number, r: number, q: number): [number, number] {
  const vt = iv * Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r - q + iv * iv / 2) * T) / vt
  return [d1, d1 - vt]
}

const expired = (S: number, T: number, iv: number): boolean => T <= 0 || iv <= 0 || S <= 0

/** Plain Black-Scholes value (no intrinsic floor). At T <= 0 it is intrinsic. */
export function bsPrice(kind: OptionKind, S: number, K: number, T: number, iv: number, r = DEFAULT_RATE, q = 0): number {
  if (expired(S, T, iv)) return intrinsic(kind, S, K)
  const [d1, d2] = d1d2(S, K, T, iv, r, q)
  const fwdS = S * Math.exp(-q * T)
  const pvK = K * Math.exp(-r * T)
  return kind === 'call' ? fwdS * normCdf(d1) - pvK * normCdf(d2) : pvK * normCdf(-d2) - fwdS * normCdf(-d1)
}

/** Black-Scholes floored at intrinsic; exactly intrinsic at 0 days left. */
export function optionValue(kind: OptionKind, S: number, K: number, T: number, iv: number, r = DEFAULT_RATE, q = 0): number {
  return Math.max(bsPrice(kind, S, K, T, iv, r, q), intrinsic(kind, S, K))
}

export function bsDelta(kind: OptionKind, S: number, K: number, T: number, iv: number, r = DEFAULT_RATE, q = 0): number {
  return bsGreeks(kind, S, K, T, iv, r, q).delta
}

/** Per-share Greeks of the value the chart draws: theta per year, vega per 1.00 of IV.
 *  Where the intrinsic floor binds (or at expiry) the value is intrinsic, so the Greeks are intrinsic's. */
export interface OptionGreeks { delta: number; gamma: number; theta: number; vega: number }
export function bsGreeks(kind: OptionKind, S: number, K: number, T: number, iv: number, r = DEFAULT_RATE, q = 0): OptionGreeks {
  const floorBinds = !expired(S, T, iv) && bsPrice(kind, S, K, T, iv, r, q) < intrinsic(kind, S, K)
  if (expired(S, T, iv) || floorBinds) {
    const itm = intrinsic(kind, S, K) > 0
    return { delta: itm ? (kind === 'call' ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 }
  }
  const [d1, d2] = d1d2(S, K, T, iv, r, q)
  const dq = Math.exp(-q * T)
  const pvK = K * Math.exp(-r * T)
  const decay = -S * dq * normPdf(d1) * iv / (2 * Math.sqrt(T))
  const gamma = dq * normPdf(d1) / (S * iv * Math.sqrt(T))
  const vega = S * dq * normPdf(d1) * Math.sqrt(T)
  if (kind === 'call') {
    return { delta: dq * normCdf(d1), gamma, vega, theta: decay - r * pvK * normCdf(d2) + q * S * dq * normCdf(d1) }
  }
  return { delta: -dq * normCdf(-d1), gamma, vega, theta: decay + r * pvK * normCdf(-d2) - q * S * dq * normCdf(-d1) }
}

/** The IV in [1%, 500%] that reprices the option (floored value) to `price` within $0.0005; null if none fits. */
export function impliedVol(kind: OptionKind, S: number, K: number, T: number, price: number, r = DEFAULT_RATE, q = 0): number | null {
  if (!(T > 0) || !(S > 0) || !(K > 0) || !Number.isFinite(price)) return null
  const f = (iv: number): number => optionValue(kind, S, K, T, iv, r, q) - price
  let lo = IV_MIN
  let hi = IV_MAX
  if (Math.abs(f(lo)) <= IV_PRICE_TOL) return lo
  if (Math.abs(f(hi)) <= IV_PRICE_TOL) return hi
  if (f(lo) > 0 || f(hi) < 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (Math.abs(fm) <= IV_PRICE_TOL) return mid
    if (fm < 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
