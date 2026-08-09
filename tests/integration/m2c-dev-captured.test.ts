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

  it('requires a session (401) and an organizer (403 submitter)', async () => {
    await startFor('speaker-a@example.test', LOCAL)
    const noSession = await app.request(
      '/api/dev/captured?email=speaker-a@example.test',
      undefined,
      bindings(LOCAL),
    )
    expect(noSession.status).toBe(401)

    const submitter = await submitterCookie(env.DB, LOCAL)
    const submitterResponse = await app.request(
      '/api/dev/captured?email=speaker-a@example.test',
      { headers: { cookie: cookieHeader(submitter) } },
      bindings(LOCAL),
    )
    expect(submitterResponse.status).toBe(403)
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
