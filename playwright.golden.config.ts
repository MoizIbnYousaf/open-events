import { defineConfig, devices } from '@playwright/test'

/**
 * Organizer end-to-end gate (`pnpm e2e:golden`): every spec that signs in with
 * the local admin token, which the default `pnpm e2e` gate deliberately leaves
 * out. Requires LOCAL_ADMIN_TOKEN in the environment — the wrapper below writes
 * it into the local `.dev.vars` the dev server reads, and restores whatever was
 * there when the run ends.
 *
 * The wrapper also runs db-reset BEFORE launching the dev server so the Worker
 * opens a fresh D1 database (Playwright starts the webServer before any test
 * hook, so an in-spec reset would race workerd's open handle).
 *
 * All specs share that ONE freshly reset database, so their order is pinned
 * rather than left to file-name sorting: m2d-golden asserts EXACT form-scoped
 * row totals for the submission it creates, and the lifecycle tail adds a
 * second submission to the same form. `dependencies` runs each project to
 * completion before the next and skips it when the one it depends on fails;
 * `workers: 1` keeps them off the shared database at the same time. The
 * organizer builder proof reads only, so it runs last.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node scripts/golden-dev-server.mjs',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    // Without this the web server is torn down with SIGKILL, which no handler
    // can observe, and the wrapper's local `.dev.vars` survives the run and
    // changes what later local runs see. SIGTERM lets the wrapper restore what
    // was there before and stop the dev server it started; the timeout is the
    // outer bound on the wrapper's own shutdown, which escalates sooner.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
  projects: [
    {
      name: 'golden',
      testMatch: 'm2d-golden.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'lifecycle',
      testMatch: 'lifecycle-golden.spec.ts',
      dependencies: ['golden'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'organizer',
      testMatch: 'builder-link-hit-area.spec.ts',
      dependencies: ['lifecycle'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
