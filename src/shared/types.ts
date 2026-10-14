/** The contract between the main process (scanner, market data, TradingView) and the renderer. Ratios are fractions. */
export type Level = 1 | 2 | 3
/** Exit tags a scanner may write: 'TP' = take profit (sell all); 'TP 1' / 'TP 2' = a two-step exit (half, then the rest). */
export type ExitTag = 'TP' | 'TP 1' | 'TP 2' | 'STOP LOSS' | 'TIME'

export interface PutQuote {
  expiry: string; strike: number; bid: number | null; ask: number | null; mid: number | null
  spreadPct: number | null; delta: number | null; note: string | null
  wingStrike: number | null; wingMid: number | null; credit: number | null; width: number | null
  /** Good-till-canceled buy-back price per share (the take-profit rule, by default 50% of the mid). */
  buyback: number | null
  /** false = no live bid/ask when the scan ran (before the open / after hours): the price is the last trade. */
  live: boolean
}
/** Optional backtest results for a signal level, from the scanner's tested_* columns (fractions; null when not written). */
export interface Tested {
  putWon: number | null; putAvg: number | null                       // cash-secured put: share won, average profit per trade as a share of cash
  spreadWon: number | null; spreadMid: number | null; spreadNatural: number | null   // put credit spread at the mid: won, avg of max loss; avg at bid/ask
}
export interface Signal {
  ticker: string; level: Level; kind: 'tagged' | 'forming' | 'near'; date: string; daysAgo: number
  priceThen: number; priceNow: number
  won: number | null; trades: number          // the stock's historical win rate at this level, and how many trades it rests on
  nextEarn: string | null
  tested: Tested | null
  borderline: boolean; detail: string | null
  put: PutQuote | null
}
export interface ExitRow {
  ticker: string; level: Level; enter: string; enterPrice: number; tag: ExitTag
  date: string; daysAgo: number; price: number; move: number; forming: boolean
}
export interface ScanResult {
  file: string; scannedAtNy: string   // 'YYYY-MM-DD HH:MM' from the file name
  signals: Signal[]; exits: ExitRow[]; skippedRows: number
  version: string | null            // the scanner's own label from its `scanner` column, e.g. 'Example scanner 1.0' (null if absent)
  marketOpenAtScan: boolean         // the scan ran on a weekday between 9:30 AM and 4:00 PM New York time
  exitsSaved: boolean               // the run saved an exits file next to the scan file
  warnings: string[]                // plain sentences: columns missing from the file, rows skipped
}
export interface ScanProgress { line: string }
export interface ScanRunOutcome { ok: boolean; code: number | null; tail: string[]; result: ScanResult | null; error: string | null; cancelled?: boolean }

export interface Quote { ticker: string; name: string | null; price: number; change: number; changePct: number; time: string }
export interface OptionContract {
  type: 'call' | 'put'; expiry: string; strike: number; bid: number; ask: number; last: number | null
  iv: number | null; oi: number; volume: number
}
/** An option chain from Yahoo (about 15 minutes delayed). */
export interface Chain {
  ticker: string; expiry: string; underlying: number; calls: OptionContract[]; puts: OptionContract[]
}

export type TvInterval = 'D' | '240' | '60' | '30'
export interface Bounds { x: number; y: number; width: number; height: number }
export interface TvState { url: string; symbol: string | null; loading: boolean; signedIn: boolean | null }

export interface McApi {
  scanner: {
    latest(): Promise<ScanResult | null>
    run(): Promise<ScanRunOutcome>
    cancel(): Promise<void>
    onProgress(cb: (p: ScanProgress) => void): () => void
  }
  market: {
    quote(ticker: string): Promise<Quote>
    expirations(ticker: string): Promise<string[]>
    chain(ticker: string, expiry: string): Promise<Chain>
  }
  tv: {
    setBounds(bounds: Bounds | null): void
    show(ticker: string, interval: TvInterval): void
    back(): void; reload(): void; openExternal(): void
    /** Opens TradingView's sign-in page in the chart pane; the chart returns once the session exists. */
    signIn(): void
    onState(cb: (s: TvState) => void): () => void
  }
}
