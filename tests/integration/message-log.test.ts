import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { applyMigrations, seedDemoConf } from './m2b-helpers'
import { ALLOWED_ORIGIN, bindings, cookieHeader, loginOrganizer } from './m2c-helpers'
import app from '../../src/server'

/**
 * The organizer's outbound log.
 *
 * Every message the product writes has always been recorded and never shown.
 * "Did that invitation actually arrive?" is a question every programme chair
 * asks, and the only answer available was to ask the recipient.
 */
describe('the organizer message log', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
  })

  async function organizerCookie(): Promise<string> {
    return (await loginOrganizer()).token ?? ''
  }

  async function log(cookie: string): Promise<readonly Record<string, unknown>[]> {
    const response = await app.request(
      '/api/admin/events/demo-conf-2026/messages',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(response.status).toBe(200)
    return (await response.json()) as readonly Record<string, unknown>[]
  }

  async function requestSignInLink(email: string): Promise<void> {
    const response = await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN },
        body: JSON.stringify({ email, eventSlug: 'demo-conf-2026', formSlug: 'cfp' }),
      },
      bindings(),
    )
    expect(response.status).toBe(202)
  }

  it('shows what the event has sent, newest first', async () => {
    const organizer = await organizerCookie()
    await requestSignInLink('first@example.test')
    await requestSignInLink('second@example.test')

    const entries = await log(organizer)

    expect(entries.length).toBeGreaterThanOrEqual(2)
    // Newest first: an organizer opening this is looking for what just
    // happened, not for the first thing the event ever sent.
    expect(entries[0]?.toEmail).toBe('second@example.test')
  })

  it('carries the body, so a sign-in link can actually be read', async () => {
    const organizer = await organizerCookie()
    await requestSignInLink('ada@example.test')

    const entry = (await log(organizer)).find((row) => row.toEmail === 'ada@example.test')

    // The whole point. Without the body the log answers "we sent something",
    // which is not the question anybody has.
    expect(String(entry?.body)).toContain('token=')
    expect(entry?.subject).toBeTruthy()
  })

  it('is organizer-only', async () => {
    const response = await app.request(
      '/api/admin/events/demo-conf-2026/messages',
      undefined,
      bindings(),
    )
    expect(response.status).toBe(401)
  })

  it('never shows another event a message it did not send', async () => {
    const organizer = await organizerCookie()
    await requestSignInLink('ada@example.test')

    const response = await app.request(
      '/api/admin/events/not-an-event/messages',
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )

    // Event scope resolves before the read, so an unknown slug is a safe
    // not-found rather than somebody else's correspondence.
    expect(response.status).toBe(404)
  })
})
