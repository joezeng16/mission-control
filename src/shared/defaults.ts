/**
 * Trading defaults the app ships with, in one place. They are common conventions for selling puts, not advice:
 * change them here to match your own rules. Ratios are fractions (0.5 = 50%).
 */
import type { Level } from './types'

/** The put delta the calculator aims for at each signal level (a stronger signal sells a little closer to the money). */
export const LEVEL_DELTA: Readonly<Record<Level, number>> = { 3: 0.3, 2: 0.2, 1: 0.15 }

/** The sold put's delta for a ticker typed by hand (no signal level to go on). */
export const TYPED_PUT_DELTA = 0.3

/** The delta of the bought put (the "wing") of a put credit spread. */
export const WING_DELTA = 0.1

/** Your take-profit rule on credit trades: buy back at 50% of what you collected (a good-till-canceled order). */
export const TAKE_PROFIT_LEFT = 0.5

/** A bid/ask gap wider than this share of the mid is flagged "wide": use a limit order near the mid. */
export const WIDE_SPREAD = 0.15

/** How many trading days back the scanner is asked to look (passed to the scanner script as its first argument). */
export const SCAN_DAYS_BACK = 5

/** Under this many backtest trades a stock's win rate says little, so the app greys it out. */
export const MIN_TRADES = 10
