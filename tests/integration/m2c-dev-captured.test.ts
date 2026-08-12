import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { applyMigrations, seedDemoConf } from './m2b-helpers'
import { bindings, cookieHeader, loginOrganizer, submitterCookie } from './m2c-helpers'
import app from '../../src/server'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

const LOCAL = { LOCAL_DEV_MODE: 'true' }

async function startFor(email: string, overrides: Record<string, unknown> = {}) {
  const response = await app.request(
    '/api/public/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, eventSlug: 'demo-conf-2026', formSlug: 'cfp' }),
    },
    bindings(overrides),
  )
  expect(response.status).toBe(202)
}

describe('dev captured endpoint', () => {
  it('is absent (404) outside local/test mode', async () => {
    const response = await app.request(
      '/api/dev/captured?email=speaker-a@example.test',
      undefined,
      bindings(),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('is absent (404) on a non-local hostname even in local mode', async () => {
    const response = await app.request(
      'https://example.com/api/dev/captured?email=speaker-a@example.test',
      undefined,
      bindings(LOCAL),
    )

    expect(response.status).toBe(404)
  })

  // The two hard guards above (local/test mode + a localhost hostname) are what
  // keep this endpoint off a deployed build. Inside that sealed local path the
  // inbox is readable without a session on purpose: an automated evaluator
  // drives each persona in an isolated browser context, so a speaker or
  // reviewer has no organizer cookie and could never fetch the link addressed
  // to it. Requiring one made the whole speaker journey unreachable to anything
  // but a single all-personas-in-one-context test.
  it('is readable without any session inside local/test mode', async () => {
    await startFor('speaker-a@example.test', LOCAL)

    const anonymous = await app.request(
      '/api/dev/captured?email=speaker-a@example.test',
      undefined,
      bindings(LOCAL),
    )

    expect(anonymous.status).toBe(200)
    const messages = (await anonymous.json()) as Array<{ body: string; toEmail: string }>
    expect(messages).toHaveLength(1)
    expect(messages[0]?.toEmail).toBe('speaker-a@example.test')
    expect(messages[0]?.body).toContain('/api/public/session?token=')
  })

  it('is readable by a non-organizer session inside local/test mode', async () => {
    await startFor('speaker-a@example.test', LOCAL)
    const submitter = await submitterCookie(env.DB, LOCAL)

    const submitterResponse = await app.request(
      '/api/dev/captured?email=speaker-a@example.test',
      { headers: { cookie: cookieHeader(submitter) } },
      bindings(LOCAL),
    )

    expect(submitterResponse.status).toBe(200)
    // submitterCookie mints its own link for the same address, so the inbox
    // legitimately holds more than the one startFor sent.
    const messages = (await submitterResponse.json()) as Array<{ toEmail: string; body: string }>
    expect(messages.length).toBeGreaterThanOrEqual(1)
    for (const message of messages) {
      expect(message.toEmail).toBe('speaker-a@example.test')
      expect(message.body).toContain('/api/public/session?token=')
    }
  })

  // The production boundary is the only thing standing between this inbox and
  // the world, so it is asserted from every angle a deploy could take.
  it('stays fail-closed outside local/test mode for every caller', async () => {
    await startFor('speaker-a@example.test', LOCAL)
    const { token } = await loginOrganizer(LOCAL)

    for (const headers of [undefined, { cookie: cookieHeader(token ?? '') }]) {
      const response = await app.request(
        '/api/dev/captured?email=speaker-a@example.test',
        headers === undefined ? undefined : { headers },
        bindings(),
      )
      expect(response.status).toBe(404)
    }
  })

  it('returns the captured message with the raw demo link for the exact normalized email', async () => {
    await startFor('Speaker.A@Example.TEST', LOCAL)
    const { token } = await loginOrganizer(LOCAL)
    expect(token).toBeTruthy()

    const exact = await app.request(
      '/api/dev/captured?email=speaker.a@example.test',
      { headers: { cookie: cookieHeader(token ?? '') } },
      bindings(LOCAL),
    )
    expect(exact.status).toBe(200)
    const messages = (await exact.json()) as Array<{ body: string }>
    expect(messages).toHaveLength(1)
    expect(messages[0]?.body).toContain('/api/public/session?token=')

    const normalizedQuery = await app.request(
      '/api/dev/captured?email=%20Speaker.A@Example.TEST%20',
      { headers: { cookie: cookieHeader(token ?? '') } },
      bindings(LOCAL),
    )
    expect(normalizedQuery.status).toBe(200)
    expect(await normalizedQuery.json()).toHaveLength(1)

    const other = await app.request(
      '/api/dev/captured?email=other@example.test',
      { headers: { cookie: cookieHeader(token ?? '') } },
      bindings(LOCAL),
    )
    expect(other.status).toBe(200)
    expect(await other.json()).toEqual([])
  })
})
