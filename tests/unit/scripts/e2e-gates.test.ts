import { describe, expect, it } from 'vitest'

import defaultGate from '../../../playwright.config'

// The documented default end-to-end gate (`pnpm e2e`) has to run from a clean
// checkout. A fresh clone carries no local database state — `.wrangler/` is
// ignored — and the smoke spec asserts a console-error-free load, which an
// unseeded database fails with a 500 from the events route. So the gate has to
// prepare the data it reads before it serves the app, the way the organizer
// gate's dev server wrapper already does.

function singleWebServer(config: typeof defaultGate): { command: string } {
  const webServer = config.webServer
  if (webServer === undefined || Array.isArray(webServer)) {
    throw new Error('the default end-to-end gate must configure exactly one web server')
  }
  return webServer
}

describe('default end-to-end gate', () => {
  it('resets the local database before it serves the app', () => {
    const { command } = singleWebServer(defaultGate)

    const resetAt = command.indexOf('db:reset')
    const serveAt = command.indexOf('dev --port 4173')

    expect(resetAt).toBeGreaterThanOrEqual(0)
    expect(serveAt).toBeGreaterThan(resetAt)
  })
})
