import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'https://open-events.speakerops.workers.dev',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'golden-live',
      testMatch: 'm2d-golden.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'lifecycle-live',
      testMatch: 'lifecycle-golden.spec.ts',
      dependencies: ['golden-live'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'organizer-live',
      testMatch: 'builder-link-hit-area.spec.ts',
      dependencies: ['lifecycle-live'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
