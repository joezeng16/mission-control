import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
import { shell } from 'electron'
import { isSafeExternal, openExternalSafe } from '../src/main/safe-url'

describe('external links', () => {
  it('only http and https leave the app', () => {
    expect(isSafeExternal('https://www.reuters.com/markets')).toBe(true)
    expect(isSafeExternal('http://example.com')).toBe(true)
    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'smb://evil/share', 'ms-settings:', 'javascript:alert(1)', 'not a url'])
      expect(isSafeExternal(bad)).toBe(false)
    openExternalSafe('file:///C:/x.exe')
    expect(shell.openExternal).not.toHaveBeenCalled()
    openExternalSafe('https://www.tradingview.com/chart/')
    expect(shell.openExternal).toHaveBeenCalledWith('https://www.tradingview.com/chart/')
  })
})
