import { defineConfig } from '@playwright/test'

// capture.spec.ts regenerates the README images; it runs only through playwright.capture.config.ts (npm run capture)
export default defineConfig({ testDir: 'e2e', testIgnore: 'capture.spec.ts', timeout: 120_000, workers: 1, reporter: 'list' })
