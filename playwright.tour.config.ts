import { defineConfig, devices } from '@playwright/test'

/** Cold-start guided-tour proof against a complete synthetic DemoConf fixture. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'tour-cold-start.spec.ts',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'LOCAL_ADMIN_TOKEN=tour-local-only OPEN_EVENTS_E2E_FIXTURE=showcase node scripts/golden-dev-server.mjs',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
  projects: [{ name: 'tour', use: { ...devices['Desktop Chrome'] } }],
})
