import { defineConfig, devices } from '@playwright/test'

/**
 * Default end-to-end gate (`pnpm e2e`): the specs that need no local secrets,
 * so the documented command is green from a clean checkout.
 *
 * "Clean checkout" includes the database. A fresh clone has no local D1 state —
 * `.wrangler/` is ignored — and the smoke spec asserts a console-error-free
 * load, which an unseeded database fails with a 500. So this gate resets and
 * seeds the local database before it serves the app, exactly as the organizer
 * gate's dev server wrapper does. That reset is skipped along with the rest of
 * the command when `reuseExistingServer` attaches to a dev server that is
 * already running locally, which leaves a developer's own running server and
 * its data alone.
 *
 * The organizer proofs sign in with a local admin token and need the dedicated
 * dev server wrapper, so they live in `playwright.golden.config.ts` and run
 * under `pnpm e2e:golden`. They are excluded here rather than left to fail on a
 * missing token; a new spec that needs the token belongs in that config and in
 * this list.
 */
const ORGANIZER_SPECS = [
  '**/m2d-golden.spec.ts',
  '**/lifecycle-golden.spec.ts',
  '**/builder-link-hit-area.spec.ts',
]

export default defineConfig({
  testDir: './e2e',
  testIgnore: ORGANIZER_SPECS,
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm db:reset && pnpm dev --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
