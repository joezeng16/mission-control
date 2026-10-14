import { describe, expect, it, vi } from 'vitest'
import { createMarketService, plainYahooError, type YahooLike } from '../src/main/market'

const T0 = new Date('2026-10-12T15:00:00Z')

function fakeYf(): YahooLike & { quote: ReturnType<typeof vi.fn>; options: ReturnType<typeof vi.fn> } {
  return {
    quote: vi.fn(async (symbol: string) => ({
      symbol, shortName: 'Berkshire B', regularMarketPrice: 470.5, regularMarketChange: -2.5,
      regularMarketChangePercent: -0.53, regularMarketTime: new Date('2026-10-12T14:59:00Z')
    })),
    options: vi.fn(async (symbol: string, opts?: { date?: Date }) => ({
      underlyingSymbol: symbol,
      expirationDates: [new Date('2026-11-20T00:00:00Z'), new Date('2026-10-16T00:00:00Z')],
      quote: { regularMarketPrice: 470.5 },
      options: [{
        expirationDate: opts?.date ?? new Date('2026-10-16T00:00:00Z'),
        calls: [{ strike: 480, bid: 5.1, ask: 5.3, lastPrice: 5.2, impliedVolatility: 0.22, openInterest: 900, volume: 40 }],
        puts: [
          { strike: 450, bid: 3.0, ask: 3.2, lastPrice: 3.1, impliedVolatility: 0.25, openInterest: 1200, volume: 77 },
          { strike: 300, lastPrice: 0.01, impliedVolatility: 0.00001 }
        ]
      }]
    }))
  }
}

describe('market service', () => {
  it('maps a quote, dots become dashes for Yahoo, change % is a fraction', async () => {
    const yf = fakeYf()
    const m = createMarketService({ yf, now: () => T0 })
    const q = await m.quote(' brk.b ')
    expect(yf.quote).toHaveBeenCalledWith('BRK-B')
    expect(q).toEqual({ ticker: 'BRK.B', name: 'Berkshire B', price: 470.5, change: -2.5, changePct: -0.0053, time: '2026-10-12T14:59:00.000Z' })
  })

  it('rejects bad tickers without calling Yahoo', async () => {
    const yf = fakeYf()
    const m = createMarketService({ yf, now: () => T0 })
    for (const bad of ['', '1ABC', 'NV DA', 'ABCDEFGHIJK', 'NVDA!']) await expect(m.quote(bad)).rejects.toThrow(/ticker/i)
    await expect(m.chain('NVDA', '10/16/2026')).rejects.toThrow(/expiry/i)
    expect(yf.quote).not.toHaveBeenCalled(); expect(yf.options).not.toHaveBeenCalled()
  })

  it('caches answers for 60 seconds', async () => {
    const yf = fakeYf()
    let now = T0
    const m = createMarketService({ yf, now: () => now })
    await m.quote('NVDA'); await m.quote('nvda')
    expect(yf.quote).toHaveBeenCalledTimes(1)
    now = new Date(T0.getTime() + 59_000); await m.quote('NVDA')
    expect(yf.quote).toHaveBeenCalledTimes(1)
    now = new Date(T0.getTime() + 61_000); await m.quote('NVDA')
    expect(yf.quote).toHaveBeenCalledTimes(2)
  })

  it('lists expirations as sorted YYYY-MM-DD', async () => {
    const m = createMarketService({ yf: fakeYf(), now: () => T0 })
    expect(await m.expirations('NVDA')).toEqual(['2026-10-16', '2026-11-20'])
  })

  it('maps a chain; junk IV becomes null and missing bid/ask become 0', async () => {
    const yf = fakeYf()
    const m = createMarketService({ yf, now: () => T0 })
    const c = await m.chain('NVDA', '2026-11-20')
    expect(yf.options).toHaveBeenCalledWith('NVDA', { date: new Date('2026-11-20T00:00:00Z') })
    expect(c.ticker).toBe('NVDA'); expect(c.expiry).toBe('2026-11-20'); expect(c.underlying).toBe(470.5)
    expect(c.calls).toEqual([{ type: 'call', expiry: '2026-11-20', strike: 480, bid: 5.1, ask: 5.3, last: 5.2, iv: 0.22, oi: 900, volume: 40 }])
    expect(c.puts.map((p) => p.strike)).toEqual([300, 450]) // sorted by strike
    expect(c.puts[0]).toEqual({ type: 'put', expiry: '2026-11-20', strike: 300, bid: 0, ask: 0, last: 0.01, iv: null, oi: 0, volume: 0 })
  })

  it('turns Yahoo failures into a plain message and does not cache them', async () => {
    const yf = fakeYf()
    yf.quote.mockRejectedValueOnce(new Error('HTTP 429'))
    const m = createMarketService({ yf, now: () => T0 })
    await expect(m.quote('NVDA')).rejects.toThrow(/NVDA.*limiting requests/)
    await expect(m.quote('NVDA')).resolves.toMatchObject({ price: 470.5 })
  })

  it('errors when Yahoo has no price', async () => {
    const yf = fakeYf()
    yf.quote.mockResolvedValueOnce({ symbol: 'ZZZZ' })
    const m = createMarketService({ yf, now: () => T0 })
    await expect(m.quote('ZZZZ')).rejects.toThrow(/no price/i)
  })
})

describe('chain stock price', () => {
  it('falls back to a quote when the chain has no price, and refuses a zero', async () => {
    const yf = fakeYf()
    const base = yf.options.getMockImplementation() as (s: string, o?: { date?: Date }) => Promise<Record<string, unknown>>
    yf.options.mockImplementation(async (s: string, o?: { date?: Date }) => ({ ...(await base(s, o)), quote: {} }))
    const m = createMarketService({ yf, now: () => T0 })
    expect((await m.chain('NVDA', '2026-11-20')).underlying).toBe(470.5)
    yf.quote.mockImplementation(async (symbol: string) => ({ symbol, regularMarketPrice: 0 }))
    const m2 = createMarketService({ yf, now: () => T0 })
    await expect(m2.chain('AMD', '2026-11-20')).rejects.toThrow(/stock price/i)
  })
})

describe('yahoo failures', () => {
  it('a request that hangs fails with a plain timeout', async () => {
    const yf: YahooLike = { quote: () => new Promise(() => {}), options: () => new Promise(() => {}) }
    const m = createMarketService({ yf, now: () => T0, timeoutMs: 20 })
    await expect(m.quote('AAPL')).rejects.toThrow(/AAPL.*didn't answer within/)
  })

  it('rate limits and lost connections read as plain words', () => {
    expect(plainYahooError(new Error('HTTP 429 Too Many Requests'))).toMatch(/limiting requests/)
    expect(plainYahooError(new Error('getaddrinfo ENOTFOUND query1.finance.yahoo.com'))).toMatch(/internet connection/)
    expect(plainYahooError(new Error('Not Found'))).toBe('Not Found')
  })
})

describe('shared fetches', () => {
  it('identical requests at the same time make one fetch', async () => {
    const yf = fakeYf()
    const y = createMarketService({ yf, now: () => T0 })
    await Promise.all([y.quote('AAPL'), y.quote('AAPL'), y.quote('MSFT')])
    expect(yf.quote).toHaveBeenCalledTimes(2)
    const [a, b] = await Promise.all([y.chain('NVDA', '2026-11-20'), y.chain('nvda', '2026-11-20')])
    expect(a).toEqual(b)
    expect(yf.options).toHaveBeenCalledTimes(1)
  })

  it('a shared Yahoo failure reaches every caller and is not cached', async () => {
    const yf = fakeYf()
    yf.quote.mockRejectedValueOnce(new Error('HTTP 429'))
    const m = createMarketService({ yf, now: () => T0 })
    const both = await Promise.allSettled([m.quote('NVDA'), m.quote('NVDA')])
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(yf.quote).toHaveBeenCalledTimes(1)
    await expect(m.quote('NVDA')).resolves.toMatchObject({ price: 470.5 })
  })
})
