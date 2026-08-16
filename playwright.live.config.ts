import { defineConfig, devices } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { acceptanceTargetFromEnv } from './scripts/acceptance-target.mjs'

const allowMutation = process.env.LIVE_ALLOW_MUTATION === 'acceptance'
if (allowMutation && process.env.LIVE_RUN_ID === undefined) {
  process.env.LIVE_RUN_ID = randomUUID().replaceAll('-', '')
}
const configuredBase = process.env.LIVE_BASE_URL
if (configuredBase === undefined) throw new Error('LIVE_BASE_URL is required')
if (allowMutation && (process.env.LOCAL_ADMIN_TOKEN ?? '').length === 0) {
  throw new Error('LOCAL_ADMIN_TOKEN is required for an acceptance lifecycle run')
}
const baseURL = allowMutation ? acceptanceTargetFromEnv().baseUrl : new URL(configuredBase).origin

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: allowMutation
    ? [
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
      ]
    : [
        {
          name: 'public-live-read-only',
          testMatch: 'live-read-only.spec.ts',
          use: { ...devices['Desktop Chrome'] },
        },
      ],
})
