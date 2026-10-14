/** What a signal row hands the calculator ("Calculate" button). */
import type { Level, Tested } from '@shared/types'

export interface CalcRequest {
  ticker: string
  /** The scanner's put strike / expiry. null when the scan had no live quote: the calculator then picks by the level's delta. */
  strike: number | null
  expiry: string | null
  /** The spread's bought put (the scanner's wing) on that expiry; null = the calculator picks the wing itself. */
  wingStrike: number | null
  level: Level
  /** false = the scan ran without a live bid/ask (before the open, after hours). */
  live: boolean
  /** The level's optional backtest results from the scan file (null when the scanner writes none). */
  tested: Tested | null
  /** The good-till-canceled buy-back price per share (the take-profit rule applied to the credit), null if unknown. */
  buyback: number | null
  nonce: number
}

export { LEVEL_DELTA, TAKE_PROFIT_LEFT, WING_DELTA } from '@shared/defaults'
