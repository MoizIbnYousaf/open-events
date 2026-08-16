import type { D1Database } from '@cloudflare/workers-types'
import { env } from 'cloudflare:test'

import app from '../../src/server'
import { createSha256TokenHasher } from '../../src/application'
import { DEMO_CONF_2026_ID } from '../../src/db'
import { TURNSTILE_ALWAYS_PASS_SECRET, TURNSTILE_DUMMY_TOKEN } from '../../src/server/turnstile'
import {
  DEFAULT_ORGANIZER_SESSION_TTL_MS,
  DEFAULT_SUBMITTER_SESSION_TTL_MS,
  DEFAULT_SUBMITTER_TOKEN_TTL_MS,
  type ServerBindings,
} from '../../src/server/env'
import { latestCapturedBody } from './m2b-helpers'

export const ALLOWED_ORIGIN = 'http://localhost:8787'
export { TURNSTILE_DUMMY_TOKEN }

const ALLOW_EDGE_LIMITER: RateLimit = {
  limit: async () => ({ success: true }),
}

/** An ambient environment: the pool env, or a stand-in the guard test supplies. */
export type AmbientEnv = { readonly [K in keyof ServerBindings]?: unknown }

/**
 * The suite's value for every key `ServerBindings` declares.
 *
 * The pool environment carries whatever a local `.dev.vars` defines, and that
 * file is not part of the checkout, so nothing may reach the server by way of
 * the ambient environment. The two resource bindings can only come from the
 * pool and are forwarded by name; every value key — the admin token, the local
 * mode flag, the origin allowlist, the three TTLs, and the Clerk keys — gets a
 * suite value, whatever the ambient environment says.
 *
 * The return type is keyed by `ServerBindings`, so adding a binding to the
 * server fails `pnpm typecheck` here until the suite pins that one too.
 */
function pinnedBindings(ambient: AmbientEnv): Record<keyof ServerBindings, unknown> {
  return {
    DB: ambient.DB,
    FILES: ambient.FILES,
    ASSETS: ambient.ASSETS,
    START_RECIPIENT_RATE_LIMITER: ALLOW_EDGE_LIMITER,
    START_SOURCE_RATE_LIMITER: ALLOW_EDGE_LIMITER,
    ADMIN_LOGIN_RATE_LIMITER: ALLOW_EDGE_LIMITER,
    TOKEN_REDEEM_SOURCE_RATE_LIMITER: ALLOW_EDGE_LIMITER,
    TOKEN_REDEEM_TOKEN_RATE_LIMITER: ALLOW_EDGE_LIMITER,
    ORGANIZER_SEND_RATE_LIMITER: ALLOW_EDGE_LIMITER,
    RESEND_WEBHOOK_RATE_LIMITER: ALLOW_EDGE_LIMITER,
    // The committed TTL defaults, which `wrangler.jsonc` `vars` mirrors.
    // Pinned EMPTY on purpose. The suite must never be able to deliver real
    // mail, and capture-only is what an absent provider gives, so this is the
    // production fallback exercised rather than a special test path.
    RESEND_API_KEY: '',
    RESEND_WEBHOOK_SECRET: '',
    EMAIL_FROM: '',
    EMAIL_DELIVERY_MODE: 'capture',
    EMAIL_PAYLOAD_KEY_VERSION: 'v1',
    EMAIL_PAYLOAD_KEY_V1: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
    EMAIL_LIVE_VERIFIED_AT: '',
    CLERK_PUBLISHABLE_KEY: '',
    CLERK_SECRET_KEY: '',
    CLERK_ORGANIZER_USER_IDS: '',
    RATE_LIMIT_KEY_SECRET: 'integration-rate-limit-secret-v1',
    RATE_LIMIT_ENVIRONMENT: 'test',
    TURNSTILE_SECRET_KEY: TURNSTILE_ALWAYS_PASS_SECRET,
    TURNSTILE_HOSTNAMES: 'localhost',
    OPENROUTER_API_KEY: '',
    OPENROUTER_MODEL: '',
    ORGANIZER_SESSION_TTL_MS: String(DEFAULT_ORGANIZER_SESSION_TTL_MS),
    SUBMITTER_SESSION_TTL_MS: String(DEFAULT_SUBMITTER_SESSION_TTL_MS),
    SUBMITTER_TOKEN_TTL_MS: String(DEFAULT_SUBMITTER_TOKEN_TTL_MS),
    PUBLIC_APP_URL: 'https://www.openevents.engineer',
    TOUR_APP_URL: '',
    SUBMITTER_CAPABILITY_WRITER_MODE: 'purpose',
    SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'bounded',
    SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: '',
    LOCAL_ADMIN_TOKEN: 'admin-secret',
    LOCAL_DEV_MODE: 'false',
    DEPLOY_ENVIRONMENT: 'test',
    BUILD_REVISION: 'test-revision',
    RESOURCE_D1_ID: 'test-d1',
    RESOURCE_R2_NAME: 'test-r2',
    ACCEPTANCE_RESET_SECRET: '',
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
  // This fixture creates fresh sessions as setup, sometimes repeatedly for the
  // same seeded person. Product-budget tests use the routes directly; keep
  // unrelated scenarios outside the real two-minute recipient cooldown.
  await db.prepare("UPDATE mail_budget_events SET created_at = '2020-01-01T00:00:00.000Z'").run()
  const start = await app.request(
    '/api/public/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        eventSlug: 'demo-conf-2026',
        formSlug: 'cfp',
        turnstileToken: TURNSTILE_DUMMY_TOKEN,
      }),
    },
    bindings(overrides),
  )
  if (start.status !== 202) throw new Error(`start failed with ${start.status}`)
  const body = await latestCapturedBody(db, email)
  if (body === null) throw new Error('no captured message found')
  const raw = decodeURIComponent(body.split('token=')[1] ?? '')
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

/**
 * Trusted speaker-portal fixture. Portal purpose is selected at the application
 * boundary (never from a public request), then redeemed through the real route.
 */
export async function submitterPortalCookie(
  db: D1Database,
  overrides: Record<string, unknown> = {},
  email = 'speaker-a@example.test',
): Promise<string> {
  const now = new Date()
  const fixtureContactId = `portal-contact-${crypto.randomUUID()}`
  await db
    .prepare(
      `INSERT INTO contacts (id, email, name, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING`,
    )
    .bind(fixtureContactId, email, email, now.toISOString())
    .run()
  const contact = await db
    .prepare('SELECT id FROM contacts WHERE email = ?')
    .bind(email)
    .first<{ id: string }>()
  if (contact === null) throw new Error('portal fixture contact is missing')
  const raw = `portal-fixture-${crypto.randomUUID()}`
  await db
    .prepare(
      `INSERT INTO submitter_tokens
       (id, event_id, contact_id, form_id, purpose, token_hash, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, NULL, 'portal', ?, ?, NULL, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      DEMO_CONF_2026_ID,
      contact.id,
      await createSha256TokenHasher().hash(raw),
      new Date(now.getTime() + DEFAULT_SUBMITTER_TOKEN_TTL_MS).toISOString(),
      now.toISOString(),
    )
    .run()
  const redeem = await app.request(
    `/api/public/session?token=${encodeURIComponent(raw)}`,
    undefined,
    bindings(overrides),
  )
  if (redeem.status !== 303 || redeem.headers.get('location') !== '/portal') {
    throw new Error(`portal redeem failed with ${redeem.status}`)
  }
  const token = parseCookieToken(redeem.headers.get('set-cookie'))
  if (token === null) throw new Error('portal redeem set no session cookie')
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
