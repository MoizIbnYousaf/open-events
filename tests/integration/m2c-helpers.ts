import type { D1Database } from '@cloudflare/workers-types'
import { env } from 'cloudflare:test'

import app from '../../src/server'
import {
  DEFAULT_ORGANIZER_SESSION_TTL_MS,
  DEFAULT_SUBMITTER_SESSION_TTL_MS,
  DEFAULT_SUBMITTER_TOKEN_TTL_MS,
  type ServerBindings,
} from '../../src/server/env'

export const ALLOWED_ORIGIN = 'http://localhost:8787'

/** An ambient environment: the pool env, or a stand-in the guard test supplies. */
export type AmbientEnv = { readonly [K in keyof ServerBindings]?: unknown }

/**
 * The suite's value for every key `ServerBindings` declares.
 *
 * The pool environment carries whatever a local `.dev.vars` defines, and that
 * file is not part of the checkout, so nothing may reach the server by way of
 * the ambient environment. The two resource bindings can only come from the
 * pool and are forwarded by name; every value key — the admin token, the local
 * mode flag, the origin allowlist, and all three TTLs — gets a suite value,
 * whatever the ambient environment says.
 *
 * The return type is keyed by `ServerBindings`, so adding a binding to the
 * server fails `pnpm typecheck` here until the suite pins that one too.
 */
function pinnedBindings(ambient: AmbientEnv): Record<keyof ServerBindings, unknown> {
  return {
    DB: ambient.DB,
    FILES: ambient.FILES,
    // The committed TTL defaults, which `wrangler.jsonc` `vars` mirrors.
    ORGANIZER_SESSION_TTL_MS: String(DEFAULT_ORGANIZER_SESSION_TTL_MS),
    SUBMITTER_SESSION_TTL_MS: String(DEFAULT_SUBMITTER_SESSION_TTL_MS),
    SUBMITTER_TOKEN_TTL_MS: String(DEFAULT_SUBMITTER_TOKEN_TTL_MS),
    LOCAL_ADMIN_TOKEN: 'admin-secret',
    LOCAL_DEV_MODE: 'false',
    ALLOWED_ORIGINS: ALLOWED_ORIGIN,
  }
}

/**
 * Bindings resolved against a given ambient environment.
 *
 * Exported for the hermeticity guard, which hands in an ambient environment
 * where every value a `.dev.vars` could supply is wrong; tests use `bindings`.
 */
export function bindingsFrom(
  ambient: AmbientEnv,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...pinnedBindings(ambient), ...overrides }
}

/**
 * Pool bindings with the admin secret and a CSRF allowlist configured.
 *
 * `overrides` is the single opt-in for a test that wants a different value (for
 * example `LOCAL_DEV_MODE: 'true'` to exercise the local-only surfaces).
 */
export function bindings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return bindingsFrom(env, overrides)
}

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
  email = 'speaker-a@example.test',
): Promise<string> {
  const start = await app.request(
    '/api/public/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
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
    .bind(email)
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
