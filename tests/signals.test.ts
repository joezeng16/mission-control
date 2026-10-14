import { describe, expect, it } from 'vitest'
import type { PutQuote, Signal, Tested } from '../src/shared/types'
import {
  EXIT_TODO, calcRequestFor, hasLiveQuote, notableLines, plainPutNote, spreadOf, testedText, tradesLabel, wonView
} from '../src/renderer/src/lib/signals'
import { isStale, marketStatus, nyStampLabel, offHoursWord } from '../src/renderer/src/lib/time'

// Arbitrary test numbers, not results of any real backtest.
const TESTED: Tested = { putWon: 0.8, putAvg: 0.001, spreadWon: 0.75, spreadMid: 0.01, spreadNatural: -0.02 }

function put(over: Partial<PutQuote> = {}): PutQuote {
  return {
    expiry: '2026-04-17', strike: 195, bid: 2.1, ask: 2.5, mid: 2.3, spreadPct: 0.17, delta: -0.2, note: null,
    wingStrike: null, wingMid: null, credit: null, width: null, buyback: 1.15, live: true, ...over
  }
}

function signal(over: Partial<Signal> = {}): Signal {
  return {
    ticker: 'AAPL', level: 2, kind: 'tagged', date: '2026-03-09', daysAgo: 2, priceThen: 215, priceNow: 212,
    won: 0.955, trades: 22, nextEarn: '2026-04-30', tested: TESTED, borderline: false, detail: null, put: put(), ...over
  }
}

describe('hasLiveQuote', () => {
  it('needs live plus a real bid and ask', () => {
    expect(hasLiveQuote(put())).toBe(true)
    expect(hasLiveQuote(put({ live: false }))).toBe(false)
    expect(hasLiveQuote(put({ bid: 0, ask: 0 }))).toBe(false)
    expect(hasLiveQuote(put({ bid: null }))).toBe(false)
    expect(hasLiveQuote(null)).toBe(false)
  })
})

describe('calcRequestFor', () => {
  it('passes the scanner put when the quote is live', () => {
    expect(calcRequestFor(signal())).toEqual({
      ticker: 'AAPL', strike: 195, expiry: '2026-04-17', wingStrike: null, level: 2, live: true, tested: TESTED, buyback: 1.15
    })
  })
  it("hands over the scanner's wing and the spread's 50% buy-back when the row has a spread", () => {
    const req = calcRequestFor(signal({ put: put({ wingStrike: 185, wingMid: 0.95, credit: 1.35, width: 10 }) }))
    expect(req).toMatchObject({ strike: 195, wingStrike: 185, live: true })
    expect(req.buyback).toBeCloseTo(0.675)
  })
  it('lets the calculator pick fresh when the quote is stale or missing', () => {
    const stale = calcRequestFor(signal({ put: put({ live: false, bid: 0, ask: 0 }) }))
    expect(stale).toMatchObject({ strike: null, expiry: null, live: false, buyback: null, level: 2, tested: TESTED })
    expect(calcRequestFor(signal({ put: null }))).toMatchObject({ strike: null, expiry: null, live: false })
  })
})

describe('tradesLabel / wonView', () => {
  it('says 1 trade, not 1 trades', () => {
    expect(tradesLabel(1)).toBe('1 trade')
    expect(tradesLabel(26)).toBe('26 trades')
    expect(tradesLabel(0)).toBe('no trades')
  })
  it('greys out a record under 10 trades', () => {
    expect(wonView(signal({ trades: 4 }))).toMatchObject({ few: true, count: 'only 4 trades' })
    expect(wonView(signal({ trades: 1 }))).toMatchObject({ few: true, count: 'only 1 trade' })
    expect(wonView(signal())).toEqual({ few: false, count: '22 trades', rate: '96%' })
  })
})

describe('testedText', () => {
  it('states the optional backtest result plainly, and nothing without one', () => {
    expect(testedText(TESTED)).toBe('Backtest: 80% won, avg +0.1% of cash')
    expect(testedText(null)).toBeNull()
    expect(testedText({ ...TESTED, putWon: null })).toBeNull()
  })
})

describe('plainPutNote', () => {
  it('turns the market-closed note into plain words', () => {
    expect(plainPutNote(put({ live: false, note: 'market closed: last trade price, check again at the open' })))
      .toMatch(/market was closed/i)
  })
  it('explains a missing quote without a note', () => {
    expect(plainPutNote(put({ live: false, bid: 0, ask: 0, note: null }))).toMatch(/no live bid/i)
  })
  it('keeps a live note as is', () => {
    expect(plainPutNote(put({ note: 'WIDE spread: use a limit near the mid' }))).toBe('WIDE spread: use a limit near the mid')
  })
})

describe('notableLines', () => {
  it('keeps the lines worth reading after a run, once each', () => {
    const lines = [
      'Prices ready: 8 of 8',
      'NOT SCANNED, no prices after 3 tries (2): AAA BBB  -> run again',
      'Dropped by a rule after pricing: CCC 1/3',
      'No close yet for today on 3 (shown as of yesterday): A B C  -> run again later',
      'Too new for the scanner (1): NEWCO',
      'XYZ: chain unavailable (HTTPError)',
      'Saved scans/signals_scan.csv',
      'Dropped by a rule after pricing: CCC 1/3'
    ]
    expect(notableLines(lines)).toEqual(lines.slice(1, 6))
  })
})

describe('EXIT_TODO', () => {
  it('says what each exit tag asks for, in plain words', () => {
    expect(EXIT_TODO).toEqual({
      TP: 'Take profit: sell all',
      'TP 1': 'Take profit: sell half',
      'TP 2': 'Take profit: sell the rest',
      'STOP LOSS': 'Stop loss: sell all',
      TIME: 'Time limit: sell all'
    })
  })
})

describe('time labels (New York, ET)', () => {
  it('says before the open on a weekday morning, after the close otherwise', () => {
    expect(offHoursWord('2026-03-11 09:20')).toBe('before the open')
    expect(offHoursWord('2026-03-11 20:46')).toBe('after the close')
    expect(offHoursWord('2026-03-08 10:00')).toBe('after the close')   // Sunday
  })
  it('shows a scan stamp in ET', () => {
    expect(nyStampLabel('2026-03-11 10:05')).toEqual({ day: 'Wed, Mar 11', time: '10:05 AM ET' })
    expect(nyStampLabel('2026-03-11 20:46')).toEqual({ day: 'Wed, Mar 11', time: '8:46 PM ET' })
  })
  it('knows a stale scan and the regular session', () => {
    const wedMorning = new Date('2026-03-11T14:30:00Z')   // 10:30 AM ET (daylight time)
    expect(isStale('2026-03-11 09:20', wedMorning)).toBe(false)
    expect(isStale('2026-03-10 15:00', wedMorning)).toBe(true)
    expect(marketStatus(wedMorning)).toEqual({ open: true, clock: '10:30 AM ET', label: 'Market open until 4:00 PM ET' })
    expect(marketStatus(new Date('2026-03-11T12:00:00Z')).label).toBe('Market opens 9:30 AM ET')
    expect(marketStatus(new Date('2026-03-08T15:00:00Z')).label).toBe('Market closed')   // Sunday
  })
})

describe('spreadOf', () => {
  it('is the put credit spread on the row: collected, width, risk and the 50% buy-back, per contract', () => {
    const sp = spreadOf(put({ wingStrike: 185, wingMid: 0.95, credit: 1.35, width: 10 }))
    expect(sp).toMatchObject({ wingStrike: 185, credit: 1.35, width: 10 })
    expect(sp?.collect).toBeCloseTo(135)
    expect(sp?.risk).toBeCloseTo(865)
    expect(sp?.buyback).toBeCloseTo(0.675)
  })
  it('is null without a wing, or with a credit that is no spread', () => {
    expect(spreadOf(put())).toBeNull()
    expect(spreadOf(put({ wingStrike: 185, credit: 0, width: 10 }))).toBeNull()
    expect(spreadOf(put({ wingStrike: 185, credit: 12, width: 10 }))).toBeNull()
    expect(spreadOf(null)).toBeNull()
  })
})
