import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import type { D1Database } from '@cloudflare/workers-types'

import { createSha256TokenHasher } from '../../src/application'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID } from '../../src/db'
import { NOW, OWNER_CONTACT_ID } from '../unit/helpers/fixtures'
import { applyMigrations, countRows, seedDemoConf } from './m2b-helpers'
import { bindings } from './m2c-helpers'
import app from '../../src/server'

const FUTURE = '2026-12-31T23:59:59.000Z'
const PAST = '2020-01-01T00:00:00.000Z'
const hasher = createSha256TokenHasher()

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
  await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(OWNER_CONTACT_ID, 'speaker-a@example.test', 'Speaker A', NOW)
    .run()
})

async function insertToken(
  db: D1Database,
  raw: string,
  opts: { readonly expiresAt?: string; readonly consumedAt?: string | null } = {},
): Promise<void> {
  const hash = await hasher.hash(raw)
  await db
    .prepare(
      `INSERT INTO submitter_tokens (id, event_id, contact_id, form_id, token_hash,
                                       expires_at, consumed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `token-${crypto.randomUUID()}`,
      DEMO_CONF_2026_ID,
      OWNER_CONTACT_ID,
      DEMO_CONF_2026_FORM_ID,
      hash,
      opts.expiresAt ?? FUTURE,
      opts.consumedAt ?? null,
      NOW,
    )
    .run()
}

async function startAndReadToken(): Promise<string> {
  const start = await app.request(
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
  if (start.status !== 202) throw new Error(`start failed with ${start.status}`)
  const message = await env.DB.prepare(
    'SELECT body FROM captured_messages WHERE to_email = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind('speaker-a@example.test')
    .first<{ body: string }>()
  return decodeURIComponent(message?.body.split('token=')[1] ?? '')
}

describe('public start endpoint', () => {
  it('POST /api/public/start is an identical generic 202 for existing and new emails with no sensitive fields', async () => {
    const post = (email: string) =>
      app.request(
        '/api/public/start',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, eventSlug: 'demo-conf-2026', formSlug: 'cfp' }),
        },
        bindings(),
      )

    const contactsBefore = await countRows(env.DB, 'contacts')
    const existing = await post('speaker-a@example.test')
    const existingText = await existing.text()
    expect(existing.status).toBe(202)
    expect(JSON.parse(existingText)).toEqual({ status: 'accepted' })
    expect(existing.headers.get('set-cookie')).toBeNull()
    expect(existing.headers.get('location')).toBeNull()
    expect(existingText).not.toContain('speaker-a@example.test')
    expect(existingText).not.toContain('token')
    expect(existingText).not.toContain('/api/public/session')
    expect(existingText).not.toContain('/cfp/')

    const newEmail = await post('brand-new-speaker@example.test')
    const newEmailText = await newEmail.text()
    expect(newEmail.status).toBe(202)
    expect(JSON.parse(newEmailText)).toEqual({ status: 'accepted' })
    expect(newEmail.headers.get('set-cookie')).toBeNull()
    expect(newEmail.headers.get('location')).toBeNull()
    expect(newEmailText).not.toContain('brand-new-speaker@example.test')
    expect(newEmailText).not.toContain('token')
    expect(newEmailText).not.toContain('/api/public/session')
    expect(newEmailText).not.toContain('/cfp/')

    // No enumeration: both responses are byte-identical.
    expect(existingText).toBe(newEmailText)

    // DB-only contact delta: an existing contact adds no row; a new email adds one.
    expect(await countRows(env.DB, 'contacts')).toBe(contactsBefore + 1)
    const newContact = await env.DB.prepare('SELECT id FROM contacts WHERE email = ?')
      .bind('brand-new-speaker@example.test')
      .first<{ id: string }>()
    expect(newContact).toBeDefined()
  })
})

describe('public session redeem contract', () => {
  it('GET /api/public/session?token= returns 303 with trusted Location and session cookie attributes', async () => {
    const raw = await startAndReadToken()
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
    expect(setCookie).not.toContain('Secure')
    expect(await response.text()).toBe('')
  })

  it('sets a Secure cookie over HTTPS and denies same-token replay with a uniform 403 and one session', async () => {
    const raw = await startAndReadToken()
    const first = await app.request(
      `https://localhost/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )

    expect(first.status).toBe(303)
    expect(first.headers.get('set-cookie')).toContain('Secure')
    expect(await first.text()).toBe('')
    expect(await countRows(env.DB, 'sessions')).toBe(1)

    const replay = await app.request(
      `https://localhost/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )
    expect(replay.status).toBe(403)
    expect(await replay.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } })
    expect(replay.headers.get('location')).toBeNull()
    expect(replay.headers.get('set-cookie')).toBeNull()
    expect(await countRows(env.DB, 'sessions')).toBe(1)
  })

  it.each([
    ['malformed', 'not-a-real-token'],
    ['unknown', crypto.randomUUID()],
    ['expired', 'expired-raw-token'],
    ['used', 'used-raw-token'],
  ] as const)('denies an %s token with a uniform 403', async (label, raw) => {
    if (label === 'expired') {
      await insertToken(env.DB, raw, { expiresAt: PAST })
    } else if (label === 'used') {
      await insertToken(env.DB, raw, { consumedAt: NOW })
    }

    const response = await app.request(
      `/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } })
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await countRows(env.DB, 'sessions')).toBe(0)
  })
})
