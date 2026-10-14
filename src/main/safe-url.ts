/** Only normal web pages may leave the app for the default browser (no file:, smb:, custom protocol handlers). */
import { shell } from 'electron'

export function isSafeExternal(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export function openExternalSafe(url: string): void {
  if (isSafeExternal(url)) void shell.openExternal(url)
}
