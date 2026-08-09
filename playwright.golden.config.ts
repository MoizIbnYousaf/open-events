import { defineConfig, devices } from '@playwright/test'

/**
 * Golden-journey gate: runs db-reset BEFORE launching the dev server so the
 * Worker opens a fresh D1 database (Playwright starts the webServer before any
 * test hook, so an in-spec reset would race workerd's open handle).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'm2d-golden.spec.ts',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node scripts/golden-dev-server.mjs',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
