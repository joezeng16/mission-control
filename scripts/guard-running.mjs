// Stops a build when the packaged Mission Control is open: electron-builder can't replace a running exe (half-written folder).
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

if (process.platform === 'win32') {
  const tasklist = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe')
  const out = execFileSync(tasklist, ['/FI', 'IMAGENAME eq MissionControl.exe', '/NH'], { encoding: 'utf8' })
  if (out.includes('MissionControl.exe')) {
    console.error('Mission Control is open. Close it, then build again.')
    process.exit(1)
  }
}
