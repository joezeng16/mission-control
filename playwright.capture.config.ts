import { defineConfig } from '@playwright/test'

/** npm run capture: rebuilds docs/images/ from the built app (see e2e/capture.spec.ts). */
export default defineConfig({ testDir: 'e2e', testMatch: 'capture.spec.ts', timeout: 300_000, workers: 1, reporter: 'list' })
