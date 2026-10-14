import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { marketOpenAt, newestScanFiles, parseCsv, parseExitsCsv, parseScanCsv } from '../src/main/csv'

// Fixtures are made-up sample data (fictional prices, dates and strikes), in the format documented in the README.
const SCAN = 'signals_scan_2026-03-11_1005.csv'
const EXITS = 'signals_exits_2026-03-11_1005.csv'
const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('parseCsv (RFC 4180, tolerant)', () => {
  it('handles quoted commas, doubled quotes, CRLF, BOM and blank lines', () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,"multi\nline",\r\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'multi\nline', '']
    ])
  })

  it('keeps a last row without a trailing newline and tolerates an unclosed quote', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,b\n1,"oops')).toEqual([['a', 'b'], ['1', 'oops']])
  })
})

describe('parseScanCsv', () => {
  it('parses the sample scan file', () => {
    const { signals, skipped, warnings, version } = parseScanCsv(fixture(SCAN))
    expect(skipped).toBe(0)
    expect(warnings).toEqual([])
    expect(version).toBe('Example scanner 1.0')
    expect(signals.map((s) => s.ticker)).toEqual(['AAPL', 'NVDA', 'AMZN', 'KO'])
    const aapl = signals[0]
    expect(aapl).toMatchObject({
      ticker: 'AAPL', level: 2, kind: 'tagged', date: '2026-03-09', daysAgo: 2,
      trades: 22, nextEarn: '2026-04-30', borderline: false, detail: null, tested: null
    })
    expect(aapl.priceThen).toBeCloseTo(215.1, 6)
    expect(aapl.priceNow).toBeCloseTo(212.4, 6)
    expect(aapl.won).toBeCloseTo(0.955, 9)
    expect(aapl.put).toMatchObject({
      expiry: '2026-04-17', strike: 195, bid: 2.1, ask: 2.24, mid: 2.17, note: null,
      wingStrike: 185, wingMid: 0.95, width: 10, buyback: 0.61, live: true
    })
    expect(aapl.put?.spreadPct).toBeCloseTo(0.0645, 6)
    expect(aapl.put?.delta).toBeCloseTo(-0.2, 9)
    expect(aapl.put?.credit).toBeCloseTo(1.22, 9)

    const amzn = signals[2]
    expect(amzn).toMatchObject({ level: 1, borderline: true, detail: 'Rule B right at its threshold (example)' })
    const ko = signals[3]
    expect(ko.won).toBe(1)
    expect(ko.put).toMatchObject({ strike: 64, wingStrike: null, wingMid: null, credit: null, width: null, note: 'WIDE spread: use a limit near the mid' })
  })

  it('sets days ago to -1 for forming and near rows and nulls nan values', () => {
    const csv = [
      'ticker,level,kind,date,days_ago,price_then,price_now,won_pct,trades,next_earn,borderline,put_exp,put_strike,put_note',
      'MSFT,3/3,forming,2026-03-11,0,400,401,nan,0,,False,,,no listed options',
      'GOOGL,2/3,near,2026-03-11,0,160.5,161,80,10,2026-04-14 00:00:00,TRUE,2026-04-17 00:00:00,150,'
    ].join('\n')
    const { signals, skipped } = parseScanCsv(csv)
    expect(skipped).toBe(0)
    expect(signals[0]).toMatchObject({ level: 3, kind: 'forming', daysAgo: -1, won: null, nextEarn: null, put: null })
    expect(signals[1]).toMatchObject({ level: 2, kind: 'near', daysAgo: -1, won: 0.8, nextEarn: '2026-04-14', borderline: true })
    expect(signals[1].put).toMatchObject({ expiry: '2026-04-17', strike: 150, bid: null, note: null })
  })

  it('skips a broken row', () => {
    const lines = fixture(SCAN).trim().split(/\r?\n/)
    const broken = [
      lines[0],
      lines[1],
      ',1/3,tagged,2026-03-10,2,10,11', // no ticker
      'XYZ,abc,tagged,2026-03-10,2,10,11', // no level
      'XYZ,2/3,tagged,,2,10,11', // no date
      'XYZ,2/3,tagged,2026-03-10', // truncated: no prices
      'XYZ,2/3,weird,2026-03-10,2,10,11', // unknown kind
      lines[2]
    ].join('\r\n')
    const { signals, skipped, warnings } = parseScanCsv(broken)
    expect(signals.map((s) => s.ticker)).toEqual(['AAPL', 'NVDA'])
    expect(skipped).toBe(5)
    expect(warnings).toEqual(['5 rows in the scan file could not be read and are not shown.'])
  })

  it('returns nothing for an empty or header-only file and names missing columns', () => {
    expect(parseScanCsv('')).toEqual({ signals: [], skipped: 0, warnings: [], version: null })
    expect(parseScanCsv('\n')).toMatchObject({ signals: [], skipped: 0, version: null })
    const thin = parseScanCsv('ticker,level,kind,date\n')
    expect(thin).toMatchObject({ signals: [], skipped: 0, version: null })
    expect(thin.warnings[0]).toMatch(/no days_ago, price_then.*columns/)
  })

  it('reads the optional tested_* backtest columns as fractions', () => {
    const csv = [
      'ticker,level,kind,date,days_ago,price_then,price_now,won_pct,trades,next_earn,borderline,put_exp,put_strike,put_mid,tested_won,tested_avg,tested_spread_won,tested_spread_mid,tested_spread_natural',
      'AAPL,2/3,tagged,2026-03-09,2,215,212,95,20,,False,2026-04-17,195,2.17,80,1.5,75,6,-2'
    ].join('\n')
    const t = parseScanCsv(csv).signals[0].tested
    expect(t?.putWon).toBeCloseTo(0.8, 9)
    expect(t?.putAvg).toBeCloseTo(0.015, 9)
    expect(t?.spreadWon).toBeCloseTo(0.75, 9)
    expect(t?.spreadMid).toBeCloseTo(0.06, 9)
    expect(t?.spreadNatural).toBeCloseTo(-0.02, 9)
  })

  it('without put_buyback / put_live: buy-back from the mid (50% rule), live from bid and ask', () => {
    const csv = [
      'ticker,level,kind,date,days_ago,price_then,price_now,won_pct,trades,next_earn,borderline,put_exp,put_strike,put_bid,put_ask,put_mid',
      'NVDA,3/3,tagged,2026-03-10,1,121,119,92,25,,False,2026-04-17,110,3.05,3.25,3.15',
      'AMZN,1/3,tagged,2026-03-06,3,190,186,88,17,,False,2026-04-17,165,0,0,1.05'
    ].join('\n')
    const [nvda, amzn] = parseScanCsv(csv).signals
    expect(nvda.put?.buyback).toBeCloseTo(1.575, 9)
    expect(nvda.put?.live).toBe(true)
    expect(amzn.put?.live).toBe(false)
  })

  it('an explicit put_live wins over the bid and ask', () => {
    const csv = [
      'ticker,level,kind,date,days_ago,price_then,price_now,won_pct,trades,next_earn,borderline,put_exp,put_strike,put_bid,put_ask,put_mid,put_note,put_live',
      'KO,1/3,tagged,2026-03-10,1,67,68,100,8,,False,2026-04-17,63,0.4,0.6,0.38,market not open,False'
    ].join('\n')
    expect(parseScanCsv(csv).signals[0].put).toMatchObject({ live: false, note: 'market not open' })
  })
})

describe('parseExitsCsv', () => {
  it('parses the sample exits file', () => {
    const { exits, skipped } = parseExitsCsv(fixture(EXITS))
    expect(skipped).toBe(0)
    expect(exits).toHaveLength(5)
    const jpm = exits[0]
    expect(jpm).toMatchObject({ ticker: 'JPM', level: 1, enter: '2026-02-10', tag: 'TP', date: '2026-03-10', daysAgo: 1, forming: false })
    expect(jpm.enterPrice).toBeCloseTo(230.5, 6)
    expect(jpm.price).toBeCloseTo(241.6, 6)
    expect(jpm.move).toBeCloseTo(0.0481562, 6)
    expect(exits.find((x) => x.ticker === 'DIS')?.tag).toBe('STOP LOSS')
    expect(exits.find((x) => x.ticker === 'PEP')?.tag).toBe('TIME')
    expect(exits.find((x) => x.ticker === 'ORCL')?.tag).toBe('TP 1')
    expect(exits.find((x) => x.ticker === 'META')).toMatchObject({ tag: 'TP', daysAgo: -1, forming: true })
  })

  it('ignores extra columns, reads tag spelling loosely and skips unknown tags', () => {
    const csv = [
      'ticker,level,lv,enter,enter_price,tag,move,extra,date,days_ago,price,forming',
      'NVDA,3/3,3,2026-03-01,110,tp  1,0.05,x,2026-03-11,-1,115.5,True',
      'AMD,2/3,2,2026-03-01,150,TP 2,0.08,y,2026-03-09,1,162,False',
      'MU,2/3,2,2026-03-01,150,MOON,0.08,z,2026-03-09,1,162,False'
    ].join('\n')
    const { exits, skipped } = parseExitsCsv(csv)
    expect(skipped).toBe(1)
    expect(exits[0]).toMatchObject({ ticker: 'NVDA', level: 3, tag: 'TP 1', daysAgo: -1, forming: true })
    expect(exits[1]).toMatchObject({ ticker: 'AMD', level: 2, tag: 'TP 2', daysAgo: 1, forming: false })
  })
})

describe('newestScanFiles', () => {
  it('newest file wins by the stamp in its name', () => {
    const files = [
      'signals_scan_2026-03-11_0920.csv',
      'signals_scan_2026-03-11_1005.csv',
      'signals_scan_2026-03-10_2359.csv',
      'signals_exits_2026-03-11_1005.csv',
      'signals_exits_2026-03-11_0920.csv',
      'other_scan_2026-03-12_0900.csv',
      'signals_scan_2026-03-11_1005.csv.bak',
      'notes.txt'
    ]
    expect(newestScanFiles(files)).toEqual({
      scan: 'signals_scan_2026-03-11_1005.csv', exits: 'signals_exits_2026-03-11_1005.csv', stamp: '2026-03-11_1005'
    })
  })

  it('pairs exits with the same run only and returns nulls when no scan exists', () => {
    expect(newestScanFiles(['signals_exits_2026-03-11_0920.csv', 'signals_scan_2026-03-11_1005.csv']).exits).toBeNull()
    expect(newestScanFiles(['signals_exits_2026-03-11_0920.csv'])).toEqual({ scan: null, exits: null, stamp: null })
  })
})

describe('marketOpenAt', () => {
  it('knows when the market was open at the scan (New York time)', () => {
    expect(marketOpenAt('2026-03-11 10:05')).toBe(true)
    expect(marketOpenAt('2026-03-11 09:20')).toBe(false)
    expect(marketOpenAt('2026-03-11 16:00')).toBe(false)
    expect(marketOpenAt('2026-03-08 12:00')).toBe(false)   // Sunday
  })
})
