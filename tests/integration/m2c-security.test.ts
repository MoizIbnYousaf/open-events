import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { SEEDED_WORKSHOP_ANSWERS, applyMigrations, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

const FROZEN_CODES = new Set([
  'not_found',
  'validation_failed',
  'conflict',
  'unauthorized',
  'forbidden',
  'cfp_closed',
  'cfp_capped',
  'identity_limit_reached',
  'internal',
])

const FORBIDDEN_FRAGMENTS = [
  'stack',
  'SQL',
  'D1_ERROR',
  'token=',
  'LOCAL_ADMIN',
  '.dev.vars',
  'admin-secret',
]

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function assertEnvelope(response: Response): Promise<void> {
  const text = await response.text()
  expect(text.length).toBeGreaterThan(0)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`response body is not JSON: ${text.slice(0, 200)}`)
  }
  expect(body).toMatchObject({ error: { code: expect.any(String), message: expect.any(String) } })
  const code = (body as { error: { code: string } }).error.code
  expect(FROZEN_CODES.has(code)).toBe(true)
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    expect(text.toLowerCase()).not.toContain(fragment.toLowerCase())
  }
}

describe('single error envelope everywhere', () => {
  it('every non-2xx response is exactly {error:{code,message}} with no leakage', async () => {
    const failing = [
      app.request(
        '/api/admin/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret: 'wrong' }),
        },
        bindings(),
      ),
      app.request('/api/admin/events/demo-conf-2026', undefined, bindings()),
      app.request('/api/unknown-route', undefined, bindings()),
      app.request('/api/health', { method: 'POST' }, bindings()),
      app.request('/api/public/cfp/unknown-event/cfp', undefined, bindings()),
      app.request('/api/public/session?token=bad-token', undefined, bindings()),
      app.request(
        '/api/admin/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret: 'admin-secret' }),
        },
        bindings({ ORGANIZER_SESSION_TTL_MS: 'oops' }),
      ),
      app.request(
        '/api/public/start',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 'a@example.test',
            eventSlug: 'demo-conf-2026',
            formSlug: 'cfp',
          }),
        },
        {},
      ),
    ]
    for (const responsePromise of failing) {
      const response = await responsePromise
      expect(response.status).toBeGreaterThanOrEqual(400)
      await assertEnvelope(response)
    }
  })

  it('unknown routes and method mismatches return the 404 envelope', async () => {
    const unknown = await app.request('/api/does-not-exist', undefined, bindings())
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })

    const method = await app.request('/api/health', { method: 'POST' }, bindings())
    expect(method.status).toBe(404)
    expect(await method.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
  })

  it('JSON responses carry the material content-type header', async () => {
    const ok = await app.request('/api/public/cfp/demo-conf-2026/cfp', undefined, bindings())
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toContain('application/json')

    const redirect = await app.request('/api/public/session?token=whatever', undefined, bindings())
    expect(redirect.status).toBe(403)
    expect(redirect.headers.get('content-type')).toContain('application/json')
  })
})

describe('CSRF gate on all six authenticated mutations', () => {
  const MUTATIONS = [
    { method: 'PATCH', path: '/api/admin/events/demo-conf-2026', body: { venue: 'X' } },
    {
      method: 'PUT',
      path: '/api/admin/events/demo-conf-2026/taxonomies',
      body: { items: [{ kind: 'track', key: 'x', label: 'X', position: 0 }] },
    },
    {
      method: 'PUT',
      path: `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/draft`,
      body: { pages: [], elements: [], conditionRules: [], routingRules: [] },
    },
    {
      method: 'POST',
      path: `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/publish`,
      body: undefined,
    },
    {
      method: 'PUT',
      path: '/api/public/draft',
      body: {
        id: null,
        formId: DEMO_CONF_2026_FORM_ID,
        formVersionId: DEMO_CONF_2026_VERSION_ID,
        title: 't',
        answers: {},
      },
    },
    {
      method: 'POST',
      path: '/api/public/submit',
      body: {
        originDraftId: 'draft-csrf',
        formVersionId: DEMO_CONF_2026_VERSION_ID,
        title: 't',
        answers: SEEDED_WORKSHOP_ANSWERS,
        coSpeakers: [],
      },
    },
  ] as const

  it('rejects mismatched, missing, and malformed origins with 403 on every mutation', async () => {
    const { token } = await loginOrganizer()
    const submitter = await submitterCookie(env.DB)

    for (const mutation of MUTATIONS) {
      const cookie = mutation.path.startsWith('/api/admin') ? (token ?? '') : submitter
      const run = (headers: Record<string, string>) =>
        app.request(
          mutation.path,
          {
            method: mutation.method,
            headers: {
              cookie: cookieHeader(cookie),
              'content-type': 'application/json',
              ...headers,
            },
            ...(mutation.body === undefined ? {} : { body: JSON.stringify(mutation.body) }),
          },
          bindings(),
        )

      expect((await run({ origin: 'http://evil.example' })).status).toBe(403)
      expect((await run({})).status).toBe(403)
      expect((await run({ origin: 'not-a-url' })).status).toBe(403)
      expect((await run({ origin: ALLOWED_ORIGIN })).status).not.toBe(403)
    }
  })
})
