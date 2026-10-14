/**
 * Made-up sample scans for the browser preview (npm run dev:web). Every ticker, price, date and strike here is fictional:
 * a PRE-OPEN run (bid/ask 0, last-trade prices) and a LIVE run (real-looking bid/ask and buy-back prices).
 * The preview opens on the pre-open scan; Run scan (or ?mock=live) brings the live one.
 */
import type { ScanResult } from '@shared/types'
import { buildExit, buildSignal, type ExitSpec, type SigSpec } from './build'

const EXP = '2026-04-17'
const VERSION = 'Example scanner 1.0'

const live: SigSpec[] = [
  {
    t: 'NVDA', lv: 3, date: '2026-03-10', ago: 1, then: 121.4, now: 118.75, wonPct: 92, n: 25, earn: '2026-05-27',
    put: { exp: EXP, strike: 110, bid: 3.05, ask: 3.25, delta: -0.3, wing: 100, wingMid: 1.05 }
  },
  {
    t: 'AAPL', lv: 2, date: '2026-03-09', ago: 2, then: 215.1, now: 212.4, wonPct: 95.5, n: 22, earn: '2026-04-30',
    put: { exp: EXP, strike: 195, bid: 2.1, ask: 2.24, delta: -0.2, wing: 185, wingMid: 0.95 }
  },
  {
    t: 'MSFT', lv: 2, kind: 'forming', date: '2026-03-11', ago: 0, then: 405.1, now: 405.1, wonPct: 90, n: 20, earn: '2026-04-28',
    put: { exp: EXP, strike: 375, bid: 4.2, ask: 4.6, delta: -0.21, wing: 360, wingMid: 2.05 }
  },
  {
    t: 'AMZN', lv: 1, date: '2026-03-06', ago: 3, then: 190, now: 186.2, wonPct: 88.2, n: 17, earn: '2026-04-30',
    border: true, detail: 'Rule B right at its threshold (example)',
    put: { exp: EXP, strike: 170, bid: 1.3, ask: 1.42, delta: -0.15, wing: 160, wingMid: 0.55 }
  },
  {
    t: 'KO', lv: 1, date: '2026-03-10', ago: 1, then: 67.2, now: 68.15, wonPct: 100, n: 8, earn: '2026-04-21',
    put: { exp: EXP, strike: 64, bid: 0.4, ask: 0.6, delta: -0.14 }
  },
  {
    t: 'GOOGL', lv: 3, kind: 'near', date: '2026-03-11', ago: 0, then: 162.35, now: 162.35, wonPct: 91.3, n: 23, earn: '2026-04-14',
    detail: 'One rule missed by a little (example)',
    put: { exp: EXP, strike: 152.5, bid: 2.55, ask: 2.75, delta: -0.29, wing: 145, wingMid: 1.1 }
  }
]

/** The same stocks before the open: no bid/ask yet, the mid is the last trade. */
const preOpen: SigSpec[] = [
  { ...live[0], now: 119.6, put: { exp: EXP, strike: 105, bid: 0, ask: 0, delta: -0.002, wing: 95, wingMid: 0.6, last: 2.4 } },
  { ...live[1], now: 213.05, put: { exp: EXP, strike: 190, bid: 0, ask: 0, delta: -0.001, wing: 180, wingMid: 0.7, last: 1.65 } },
  { ...live[3], now: 187.4, put: { exp: EXP, strike: 165, bid: 0, ask: 0, delta: -0.001, wing: 155, wingMid: 0.4, last: 1.05 } },
  { ...live[4], now: 68.3, put: { exp: EXP, strike: 63, bid: 0, ask: 0, delta: -0.003, last: 0.38 } }
]

const exits: ExitSpec[] = [
  ['META', 2, '2026-02-17', 560, 'TP', '2026-03-11', 0, 588.9, true],
  ['JPM', 1, '2026-02-10', 230.5, 'TP', '2026-03-10', 1, 241.6],
  ['DIS', 1, '2026-02-03', 112, 'STOP LOSS', '2026-03-09', 2, 101.8],
  ['PEP', 2, '2026-01-20', 158, 'TIME', '2026-03-06', 3, 160.1],
  ['ORCL', 3, '2026-02-12', 150, 'TP 1', '2026-03-05', 4, 163.5]
]

export const sampleLive: ScanResult = {
  file: 'signals_scan_2026-03-11_1005.csv',
  scannedAtNy: '2026-03-11 10:05',
  signals: live.map(buildSignal),
  exits: exits.map(buildExit),
  skippedRows: 0,
  version: VERSION,
  marketOpenAtScan: true,
  exitsSaved: true,
  warnings: []
}

export const samplePreOpen: ScanResult = {
  ...sampleLive,
  file: 'signals_scan_2026-03-11_0920.csv',
  scannedAtNy: '2026-03-11 09:20',
  signals: preOpen.map(buildSignal),
  exits: exits.filter((e) => !e[8]).map(buildExit),
  marketOpenAtScan: false
}
