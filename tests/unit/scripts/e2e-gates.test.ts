import { describe, expect, it } from 'vitest'

import defaultGate from '../../../playwright.config'

// The documented default end-to-end gate (`pnpm e2e`) has to run from a clean
// checkout. A fresh clone carries no local database state — `.wrangler/` is
// ignored — and the smoke spec asserts a console-error-free load, which an
// unseeded database fails with a 500 from the events route. So the gate has to
// prepare the data it reads before it serves the app, the way the organizer
// gate's dev server wrapper already does.

function singleWebServer(config: typeof defaultGate): {
  command: string
  env?: NodeJS.ProcessEnv
} {
  const webServer = config.webServer
  if (webServer === undefined || Array.isArray(webServer)) {
    throw new Error('the default end-to-end gate must configure exactly one web server')
  }
  return webServer
}

describe('default end-to-end gate', () => {
  it('uses the guarded wrapper that resets before serving and restores local vars', () => {
    const { command } = singleWebServer(defaultGate)
    expect(command).toBe('LOCAL_ADMIN_TOKEN=smoke-local node scripts/golden-dev-server.mjs')
  })

  it('does not load an optional Clerk key from the developer machine', () => {
    const { env } = singleWebServer(defaultGate)
    expect(env?.VITE_CLERK_PUBLISHABLE_KEY).toBe('')
  })
})
