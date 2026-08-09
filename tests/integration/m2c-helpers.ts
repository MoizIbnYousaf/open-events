import type { D1Database } from '@cloudflare/workers-types'
import { env } from 'cloudflare:test'

import app from '../../src/server'

/** Pool env with the admin secret and a CSRF allowlist configured. */
export function bindings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...env,
    LOCAL_ADMIN_TOKEN: 'admin-secret',
    ALLOWED_ORIGINS: 'http://localhost:8787',
    ...overrides,
  }
}

export const ALLOWED_ORIGIN = 'http://localhost:8787'

export function parseCookieToken(setCookie: string | null): string | null {
  if (setCookie === null) return null
  const match = /(?:^|;\s*)sp_session=([^;]+)/.exec(setCookie)
  return match?.[1] ?? null
}

export function cookieHeader(token: string): string {
  return `sp_session=${token}`
}

export async function loginOrganizer(
  overrides: Record<string, unknown> = {},
): Promise<{ token: string | null; setCookie: string | null; status: number; body: unknown }> {
  const response = await app.request(
    '/api/admin/session',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'admin-secret' }),
    },
    bindings(overrides),
  )
  const setCookie = response.headers.get('set-cookie')
  return {
    token: parseCookieToken(setCookie),
    setCookie,
    status: response.status,
    body: await response.json().catch(() => null),
  }
}

/** Runs start + redeem through the real routes and returns the session cookie. */
export async function submitterCookie(
  db: D1Database,
  overrides: Record<string, unknown> = {},
): Promise<string> {
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
    bindings(overrides),
  )
  if (start.status !== 202) throw new Error(`start failed with ${start.status}`)
  const message = await db
    .prepare(
      'SELECT body FROM captured_messages WHERE to_email = ? ORDER BY created_at DESC LIMIT 1',
    )
    .bind('speaker-a@example.test')
    .first<{ body: string }>()
  if (message === null) throw new Error('no captured message found')
  const raw = decodeURIComponent(message.body.split('token=')[1] ?? '')
  const redeem = await app.request(
    `/api/public/session?token=${encodeURIComponent(raw)}`,
    undefined,
    bindings(overrides),
  )
  if (redeem.status !== 303) throw new Error(`redeem failed with ${redeem.status}`)
  const token = parseCookieToken(redeem.headers.get('set-cookie'))
  if (token === null) throw new Error('redeem set no session cookie')
  return token
}

export async function savePublicDraft(
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await app.request(
    '/api/public/draft',
    {
      method: 'PUT',
      headers: {
        cookie: `sp_session=${cookie}`,
        origin: 'http://localhost:8787',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        id: null,
        formId: 'f0000000-0000-4000-8000-000000000001',
        formVersionId: 'f0000000-0000-4000-8000-000000000002',
        title: 'Draft',
        answers: {},
        ...overrides,
      }),
    },
    bindings(),
  )
  if (response.status !== 200) {
    throw new Error(`draft save failed with ${response.status}`)
  }
  const draft = (await response.json()) as { id: string }
  return draft.id
}
