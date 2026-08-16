import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { createSha256TokenHasher } from '../../src/application'
import { keyedLimitKey } from '../../src/server/rate-limit'
import { applyMigrations, countRows, latestCapturedBody, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  submitterCookie,
  TURNSTILE_DUMMY_TOKEN,
} from './m2c-helpers'
import app from '../../src/server'

const hasher = createSha256TokenHasher()

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

describe('organizer login', () => {
  it('returns 200 with a session cookie and NO token in the JSON body', async () => {
    const { status, setCookie, token, body } = await loginOrganizer()

    expect(status).toBe(200)
    expect(token).toBeTruthy()
    expect(setCookie).toContain('sp_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Max-Age=')
    expect(setCookie).not.toContain('Expires=')
    expect(setCookie).not.toContain('Secure')
    expect(body).toEqual({ expiresAt: expect.any(String) })
    expect(JSON.stringify(body)).not.toContain(token ?? '')
  })

  it('adds the Secure attribute over HTTPS', async () => {
    const response = await app.request(
      'https://localhost/api/admin/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: 'admin-secret' }),
      },
      bindings(),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  it('rejects a wrong secret with 401 unauthorized', async () => {
    const response = await app.request(
      '/api/admin/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: 'wrong' }),
      },
      bindings(),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' },
    })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('rejects a missing secret with 400 and an empty configured secret with 401', async () => {
    const missing = await app.request(
      '/api/admin/session',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      bindings(),
    )
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })

    const empty = await app.request(
      '/api/admin/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: 'anything' }),
      },
      bindings({ LOCAL_ADMIN_TOKEN: '' }),
    )
    expect(empty.status).toBe(401)
  })

  it('locks after the fifth wrong secret with a bounded Retry-After', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await app.request(
        '/api/admin/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.44' },
          body: JSON.stringify({ secret: 'wrong' }),
        },
        bindings(),
      )
      expect(response.status).toBe(401)
    }
    const fifth = await app.request(
      '/api/admin/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.44' },
        body: JSON.stringify({ secret: 'wrong' }),
      },
      bindings(),
    )
    expect(fifth.status).toBe(429)
    const retryAfter = Number(fifth.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(900)

    const lockedCorrect = await app.request(
      '/api/admin/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.44' },
        body: JSON.stringify({ secret: 'admin-secret' }),
      },
      bindings(),
    )
    expect(lockedCorrect.status).toBe(429)

    await env.DB.prepare(
      `UPDATE auth_limit_events SET created_at = '2020-01-01T00:00:00.000Z'
       WHERE scope = 'admin_login_failure'`,
    ).run()
    const afterWindow = await app.request(
      '/api/admin/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.44' },
        body: JSON.stringify({ secret: 'admin-secret' }),
      },
      bindings(),
    )
    expect(afterWindow.status).toBe(200)
  })
})

describe('organizer Clerk login', () => {
  it('rejects when Clerk is not configured or the token is missing', async () => {
    const unconfigured = await app.request(
      '/api/admin/session/clerk',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'sess_whatever' }),
      },
      bindings(),
    )
    expect(unconfigured.status).toBe(401)
    expect(unconfigured.headers.get('set-cookie')).toBeNull()

    const missing = await app.request(
      '/api/admin/session/clerk',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
      bindings({ CLERK_PUBLISHABLE_KEY: 'pk_test_not-a-real-host' }),
    )
    expect(missing.status).toBe(401)
  })

  it('rejects a garbage token without leaking it', async () => {
    const response = await app.request(
      '/api/admin/session/clerk',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-jwt' }),
      },
      bindings({ CLERK_PUBLISHABLE_KEY: 'pk_test_not-a-real-host' }),
    )
    expect(response.status).toBe(401)
    expect(JSON.stringify(await response.json())).not.toContain('not-a-jwt')
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('generic public start', () => {
  it('returns 202 with no token or link in the body', async () => {
    const response = await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'speaker-a@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
        }),
      },
      bindings(),
    )

    expect(response.status).toBe(202)
    const body = (await response.json()) as { status?: string }
    expect(body).toEqual({
      status: 'accepted',
      guidance:
        'Request accepted for this demo. Email delivery is not enabled, so no inbox message will arrive.',
    })
    expect(JSON.stringify(body)).not.toContain('token')
    expect(JSON.stringify(body)).not.toContain('http')
  })

  it('returns identical guidance and creates no job when Turnstile or edge control fails', async () => {
    const request = (overrides: Record<string, unknown>) =>
      app.request(
        '/api/public/start',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.8' },
          body: JSON.stringify({
            email: 'speaker-a@example.test',
            eventSlug: 'demo-conf-2026',
            formSlug: 'cfp',
          }),
        },
        bindings(overrides),
      )
    const challengeFailure = await request({
      TURNSTILE_SECRET_KEY: 'production-shaped-secret',
      TURNSTILE_HOSTNAMES: 'openevents.engineer',
    })
    expect(challengeFailure.status).toBe(202)
    expect(await challengeFailure.json()).toEqual({
      status: 'accepted',
      guidance:
        'Request accepted for this demo. Email delivery is not enabled, so no inbox message will arrive.',
    })
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)

    const edgeFailure = await request({
      START_RECIPIENT_RATE_LIMITER: { limit: async () => ({ success: false }) },
    })
    expect(edgeFailure.status).toBe(202)
    expect(await edgeFailure.json()).toEqual({
      status: 'accepted',
      guidance:
        'Request accepted for this demo. Email delivery is not enabled, so no inbox message will arrive.',
    })
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
  })

  it('reserves the recipient cooldown atomically and keeps raw PII out of budget keys', async () => {
    const post = (email: string) =>
      app.request(
        '/api/public/start',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '2001:db8:1:2::99' },
          body: JSON.stringify({
            email,
            eventSlug: 'demo-conf-2026',
            formSlug: 'cfp',
            turnstileToken: TURNSTILE_DUMMY_TOKEN,
          }),
        },
        bindings(),
      )

    expect((await post('speaker-a@example.test')).status).toBe(202)
    expect((await post('speaker-a@example.test')).status).toBe(202)
    expect(await countRows(env.DB, 'captured_messages')).toBe(1)
    expect(await countRows(env.DB, 'mail_budget_events')).toBe(1)

    expect((await post('another-speaker@example.test')).status).toBe(202)
    expect(await countRows(env.DB, 'captured_messages')).toBe(2)
    const rows = await env.DB.prepare(
      'SELECT recipient_key, environment_key FROM mail_budget_events',
    ).all<{ recipient_key: string; environment_key: string }>()
    const serialized = JSON.stringify(rows.results)
    expect(serialized).not.toContain('speaker-a@example.test')
    expect(serialized).not.toContain('another-speaker@example.test')
    expect(serialized).not.toContain('2001:db8')
  })

  it('keeps the exact three-attempt recipient window after the one-minute edge burst resets', async () => {
    const recipientKey = await keyedLimitKey(
      'integration-rate-limit-secret-v1',
      'start-recipient',
      'attempt-capped@example.test',
    )
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await env.DB.prepare(
        `INSERT INTO auth_limit_events (id, scope, key_hash, created_at)
         VALUES (?, 'start_recipient_attempt', ?, ?)`,
      )
        .bind(`recipient-attempt-${String(attempt)}`, recipientKey, twoMinutesAgo)
        .run()
    }

    const fourth = await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.81' },
        body: JSON.stringify({
          email: 'attempt-capped@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
          turnstileToken: TURNSTILE_DUMMY_TOKEN,
        }),
      },
      bindings(),
    )

    expect(fourth.status).toBe(202)
    expect(await fourth.json()).toEqual({
      status: 'accepted',
      guidance:
        'Request accepted for this demo. Email delivery is not enabled, so no inbox message will arrive.',
    })
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
    expect(await countRows(env.DB, 'mail_budget_events')).toBe(0)
  })

  it('enforces the exact recipient and environment rolling 24-hour hard caps', async () => {
    const recipientKey = await keyedLimitKey(
      'integration-rate-limit-secret-v1',
      'start-recipient',
      'speaker-a@example.test',
    )
    const environmentKey = await keyedLimitKey(
      'integration-rate-limit-secret-v1',
      'mail-environment',
      'test',
    )
    for (let index = 0; index < 5; index += 1) {
      const instant = new Date(Date.now() - (index + 1) * 3 * 60 * 1000).toISOString()
      await env.DB.prepare(
        `INSERT INTO mail_budget_events
           (operation_id, recipient_key, environment_key, created_at)
         VALUES (?, ?, ?, ?)`,
      )
        .bind(`recipient-cap-${index}`, recipientKey, environmentKey, instant)
        .run()
    }
    const recipientCapped = await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
        body: JSON.stringify({
          email: 'speaker-a@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
          turnstileToken: TURNSTILE_DUMMY_TOKEN,
        }),
      },
      bindings(),
    )
    expect(recipientCapped.status).toBe(202)
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)

    await env.DB.prepare('DELETE FROM mail_budget_events').run()
    await env.DB.prepare(
      `WITH RECURSIVE counter(value) AS (
         SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 250
       )
       INSERT INTO mail_budget_events (operation_id, recipient_key, environment_key, created_at)
      SELECT 'environment-cap-' || value, 'v1:start-recipient:' || printf('%064x', value), ?, ?
       FROM counter`,
    )
      .bind(environmentKey, new Date(Date.now() - 3 * 60 * 1000).toISOString())
      .run()
    const environmentCapped = await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
        body: JSON.stringify({
          email: 'fresh@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
          turnstileToken: TURNSTILE_DUMMY_TOKEN,
        }),
      },
      bindings(),
    )
    expect(environmentCapped.status).toBe(202)
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
    expect(await countRows(env.DB, 'mail_budget_events')).toBe(250)
  })
})

describe('token redemption redirect', () => {
  async function startAndRedeem(overrides: Record<string, unknown> = {}) {
    await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'speaker-a@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
        }),
      },
      bindings(overrides),
    )
    const body = await latestCapturedBody(env.DB, 'speaker-a@example.test')
    return decodeURIComponent(body?.split('token=')[1] ?? '')
  }

  it('returns 303 with a trusted two-segment Location and no token in query/body', async () => {
    const raw = await startAndRedeem()
    const response = await app.request(
      `/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/cfp/demo-conf-2026/cfp')
    expect(response.headers.get('location')).not.toContain('token')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain('sp_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Max-Age=')
    expect(setCookie).not.toContain('Expires=')
    expect(setCookie).not.toContain('Secure')
    expect(await response.text()).toBe('')
  })

  it('adds the Secure attribute over HTTPS', async () => {
    const raw = await startAndRedeem()
    const response = await app.request(
      `https://localhost/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  it('sends replay of the same token to safe recovery with no new session', async () => {
    const raw = await startAndRedeem()
    const first = await app.request(
      `/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )
    expect(first.status).toBe(303)

    const replay = await app.request(
      `/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )

    expect(replay.status).toBe(303)
    expect(replay.headers.get('location')).toBe('/start?access=cfp')
    expect(await countRows(env.DB, 'sessions')).toBe(1)
  })

  it('sends an invalid token to safe recovery', async () => {
    const response = await app.request(
      '/api/public/session?token=not-a-real-token',
      undefined,
      bindings(),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/start?access=invalid')
  })

  it('limits repeated token fingerprints without revealing token state', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.request(
        '/api/public/session?token=repeated-invalid-token',
        { headers: { 'CF-Connecting-IP': '203.0.113.70' } },
        bindings(),
      )
      expect(response.status).toBe(303)
    }
    const limited = await app.request(
      '/api/public/session?token=repeated-invalid-token',
      { headers: { 'CF-Connecting-IP': '203.0.113.70' } },
      bindings(),
    )
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await limited.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } })
  })

  it('does not collapse requests without a trusted Cloudflare address into one source bucket', async () => {
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await app.request(
        `/api/public/session?token=distinct-invalid-token-${String(attempt)}`,
        undefined,
        bindings(),
      )
      expect(response.status).toBe(303)
    }
    const sourceEvents = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM auth_limit_events WHERE scope = 'redeem_source'",
    ).first<{ count: number }>()
    expect(sourceEvents?.count).toBe(0)
  })
})

describe('session cookie cases on an admin GET route', () => {
  const adminGet = (cookie: string | null) =>
    app.request(
      '/api/admin/events/demo-conf-2026',
      cookie === null ? undefined : { headers: { cookie } },
      bindings(),
    )

  it('requires a session cookie (missing → 401)', async () => {
    const response = await adminGet(null)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' },
    })
  })

  it('rejects an empty cookie with 401', async () => {
    expect((await adminGet('sp_session=')).status).toBe(401)
  })

  it('rejects a malformed cookie with 401', async () => {
    expect((await adminGet('sp_session')).status).toBe(401)
    expect((await adminGet('sp_session=value; broken')).status).toBe(401)
  })

  it('rejects duplicate cookies with 401', async () => {
    expect((await adminGet('sp_session=a; sp_session=b')).status).toBe(401)
  })

  it('accepts a valid organizer cookie and returns the event config', async () => {
    const { token } = await loginOrganizer()
    expect(token).toBeTruthy()
    const response = await adminGet(cookieHeader(token ?? ''))
    expect(response.status).toBe(200)
  })

  it('rejects an expired session cookie with 401', async () => {
    const rawCookie = 'expired-cookie'
    await env.DB.prepare(
      `INSERT INTO sessions (id, kind, contact_id, event_id, token_hash,
                               expires_at, consumed_at, created_at)
         VALUES ('session-expired', 'organizer', NULL, NULL, ?, ?, NULL, ?)`,
    )
      .bind(await hasher.hash(rawCookie), '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')
      .run()

    expect((await adminGet(cookieHeader(rawCookie))).status).toBe(401)
  })

  it('rejects a consumed session cookie with 401', async () => {
    const rawCookie = 'consumed-cookie'
    await env.DB.prepare(
      `INSERT INTO sessions (id, kind, contact_id, event_id, token_hash,
                               expires_at, consumed_at, created_at)
         VALUES ('session-consumed', 'organizer', NULL, NULL, ?, ?, ?, ?)`,
    )
      .bind(
        await hasher.hash(rawCookie),
        '2099-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      )
      .run()

    expect((await adminGet(cookieHeader(rawCookie))).status).toBe(401)
  })

  it('rejects a submitter cookie on an organizer route with 403', async () => {
    const submitter = await submitterCookie(env.DB)
    expect((await adminGet(cookieHeader(submitter))).status).toBe(403)
  })
})

describe('session logout', () => {
  it('revokes the active session and expires its cookie', async () => {
    const { token } = await loginOrganizer()
    expect(token).toBeTruthy()

    const response = await app.request(
      '/api/session',
      {
        method: 'DELETE',
        headers: {
          cookie: cookieHeader(token ?? ''),
          origin: ALLOWED_ORIGIN,
        },
      },
      bindings(),
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('set-cookie')).toContain('sp_session=')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict')
    expect(response.headers.get('set-cookie')).toContain('Path=/')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')

    const afterLogout = await app.request(
      '/api/admin/events/demo-conf-2026',
      { headers: { cookie: cookieHeader(token ?? '') } },
      bindings(),
    )
    expect(afterLogout.status).toBe(401)
  })

  it('is idempotent when no session cookie is present', async () => {
    const response = await app.request(
      '/api/session',
      { method: 'DELETE', headers: { origin: ALLOWED_ORIGIN } },
      bindings(),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('rejects a cross-origin logout without revoking the session', async () => {
    const { token } = await loginOrganizer()
    expect(token).toBeTruthy()

    const response = await app.request(
      '/api/session',
      {
        method: 'DELETE',
        headers: {
          cookie: cookieHeader(token ?? ''),
          origin: 'https://attacker.example',
        },
      },
      bindings(),
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()

    const stillActive = await app.request(
      '/api/admin/events/demo-conf-2026',
      { headers: { cookie: cookieHeader(token ?? '') } },
      bindings(),
    )
    expect(stillActive.status).toBe(200)
  })
})

describe('TTL configuration and missing binding', () => {
  it('returns a safe 500 envelope for an invalid TTL config', async () => {
    const response = await app.request(
      '/api/admin/session',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: 'admin-secret' }),
      },
      bindings({ ORGANIZER_SESSION_TTL_MS: 'not-a-number' }),
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'Internal error' },
    })
  })

  it('returns the exact 503 envelope when the D1 binding is missing', async () => {
    const response = await app.request(
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
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'database_unavailable' },
    })
  })
})
