import { homedir } from 'node:os'
import { join } from 'node:path'

/** The scanner script the app runs, inside the scanner folder. */
export const SCAN_SCRIPT = 'scan.py'

/** The file name prefixes the scanner saves under `scans/`: signals_scan_YYYY-MM-DD_HHMM.csv and signals_exits_*.csv. */
export const SCAN_PREFIX = 'signals_scan'
export const EXITS_PREFIX = 'signals_exits'

function envValue(key: string): string | null {
  const value = process.env[key]?.trim()
  return value ? value : null
}

export interface ScannerDirOptions {
  env?: string | null
  packaged: boolean
  /** The built main script's folder (<repo>/out/main); the repo's example scanner sits two levels up. */
  mainDir: string
  home?: string
}

/**
 * Where scan.py lives. MC_SCANNER_DIR wins; in development the repo's own example-scanner folder; in the installed app
 * <home>/MissionControl/scanner. The scanner saves its CSVs in `scans/` below it.
 */
export function resolveScannerDir({ env, packaged, mainDir, home = homedir() }: ScannerDirOptions): string {
  if (env) return env
  return packaged ? join(home, 'MissionControl', 'scanner') : join(mainDir, '..', '..', 'example-scanner')
}

/** The scanner folder for this run of the app. */
export function scannerDir(packaged: boolean): string {
  return resolveScannerDir({ env: envValue('MC_SCANNER_DIR'), packaged, mainDir: __dirname })
}

/** The folder the scanner saves its CSVs in. */
export function scansDir(dir: string): string {
  return join(dir, 'scans')
}

/** The Python to run the scanner with: MC_PYTHON when set, else 'python' on Windows and 'python3' elsewhere (from PATH). */
export function pythonCommand(platform: NodeJS.Platform = process.platform): string {
  return envValue('MC_PYTHON') ?? (platform === 'win32' ? 'python' : 'python3')
}
