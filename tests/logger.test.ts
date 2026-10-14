import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cleanLogLine, maskAccountNumbers, redact } from '../src/main/log-text'

const dir = mkdtempSync(join(tmpdir(), 'mc-log-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

// Made-up ids and tokens only.
describe('log lines', () => {
  it('account-number-like strings keep only their last 4; ids, dates, ports and paths stay readable', () => {
    expect(maskAccountNumbers('account 5QZ12345 not found')).toBe('account ••2345 not found')
    expect(maskAccountNumbers('{"account_number":"000002222"} and 7AB01111.')).toBe('{"account_number":"••2222"} and ••1111.')
    for (const keep of [
      'order 8db7a7ca-78a9-4273-bbdc-e34cf4242378', '2026-10-13T18:00:00.000Z', 'port 47391', 'code 123456', '1760380800000 ms',
      'D:\\Profiles\\someone\\AppData\\Roaming\\Options Desk (test)\\logs\\main.log', 'out/main/index-B4x9Kq2a.js:123:45',
      'started v1.0.0'
    ]) expect(maskAccountNumbers(keep)).toBe(keep)
  })

  it('token-like strings are hidden too', () => {
    expect(redact('key AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 end')).toBe('key [hidden] end')
    expect(cleanLogLine('refresh failed for 5QZ12345 with eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9xyz')).toBe('refresh failed for ••2345 with [hidden]')
  })

  it('every line the app writes is cleaned, the error detail included', async () => {
    const { log } = await import('../src/main/logger')
    log('warn', 'market:chain failed for account 5QZ12345', new Error('upstream refused: no access to 9CD03333 (token AbCdEfGhIjKlMnOpQrStUvWxYz0123456789)'))
    const text = readFileSync(join(dir, 'main.log'), 'utf8')
    expect(text).toContain('account ••2345')
    expect(text).toContain('no access to ••3333')
    expect(text).toContain('[hidden]')
    expect(text).not.toMatch(/5QZ12345|9CD03333|AbCdEfGhIjKlMnOp/)
  })
})
