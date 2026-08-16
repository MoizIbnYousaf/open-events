import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import { createSha256TokenHasher, toSubmitterActor } from '../../src/application'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID } from '../../src/db'
import app from '../../src/server'
import { buildServerDeps } from '../../src/server/container'
import {
  TEST_EMAIL_DELIVERY_CONFIG,
  applyMigrations,
  countRows,
  latestCapturedBody,
  migrationsUpTo,
  seedDemoConf,
} from './m2b-helpers'
import { bindings, cookieHeader, submitterCookie } from './m2c-helpers'

const hasher = createSha256TokenHasher()
const TEST_NOW_MS = Date.now()
const LEGACY_CREATED_AT = new Date(TEST_NOW_MS - 60 * 60 * 1000).toISOString()
const LEGACY_CUTOFF = new Date(TEST_NOW_MS - 30 * 60 * 1000).toISOString()
const POST_CUTOVER_CREATED_AT = new Date(Date.parse(LEGACY_CUTOFF) + 1).toISOString()
const TOKEN_EXPIRES_AT = new Date(TEST_NOW_MS + 60 * 60 * 1000).toISOString()
const SESSION_EXPIRES_AT = new Date(TEST_NOW_MS + 24 * 60 * 60 * 1000).toISOString()

beforeEach(async () => {
  await reset()
})

async function insertLegacyToken(raw: string, createdAt: string, expiresAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO submitter_tokens
       (id, event_id, contact_id, form_id, token_hash, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      `legacy-token-${crypto.randomUUID()}`,
      DEMO_CONF_2026_ID,
      'contact-legacy',
      DEMO_CONF_2026_FORM_ID,
      await hasher.hash(raw),
      expiresAt,
      createdAt,
    )
    .run()
}

describe('purpose/capability expansion compatibility', () => {
  it('supports an old-writer rollback before activation, then re-forward and post-cutover denial', async () => {
    await applyD1Migrations(env.DB, migrationsUpTo('0025_auth_abuse_budgets.sql'))
    await seedDemoConf(env.DB)
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-legacy', 'legacy@example.test', 'Legacy', LEGACY_CREATED_AT)
      .run()

    const preMigrationRaw = 'legacy-before-expansion'
    await insertLegacyToken(preMigrationRaw, LEGACY_CREATED_AT, TOKEN_EXPIRES_AT)
    await env.DB.prepare(
      `INSERT INTO sessions
         (id, kind, contact_id, event_id, token_hash, expires_at, consumed_at, created_at)
       VALUES (?, 'submitter', ?, ?, ?, ?, NULL, ?)`,
    )
      .bind(
        'legacy-session-before-expansion',
        'contact-legacy',
        DEMO_CONF_2026_ID,
        await hasher.hash('legacy-session-before-expansion'),
        SESSION_EXPIRES_AT,
        LEGACY_CREATED_AT,
      )
      .run()

    await applyMigrations(env.DB)

    expect(
      await env.DB.prepare('SELECT purpose FROM submitter_tokens WHERE token_hash = ?')
        .bind(await hasher.hash(preMigrationRaw))
        .first(),
    ).toEqual({ purpose: null })
    expect(
      await env.DB.prepare('SELECT capability FROM sessions WHERE id = ?')
        .bind('legacy-session-before-expansion')
        .first(),
    ).toEqual({ capability: null })

    // Simulate the only permitted old-Worker rollback: schema expansion has
    // landed, but no purpose-bound writer has been activated yet.
    const rollbackRaw = 'legacy-written-by-rollback'
    await insertLegacyToken(rollbackRaw, LEGACY_CREATED_AT, TOKEN_EXPIRES_AT)

    // The re-forwarded dual Reader preserves the previous Worker's bounded
    // broad authority without guessing a new purpose.
    const recovery = await app.request(
      `/api/public/session?token=${encodeURIComponent(rollbackRaw)}`,
      undefined,
      bindings({
        SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: LEGACY_CUTOFF,
      }),
    )
    expect(recovery.status).toBe(303)
    expect(recovery.headers.get('location')).toBe('/cfp/demo-conf-2026/cfp')
    expect(recovery.headers.get('set-cookie')).toContain('sp_session=')
    expect(await countRows(env.DB, 'sessions')).toBe(2)
    expect(
      await env.DB.prepare('SELECT consumed_at FROM submitter_tokens WHERE token_hash = ?')
        .bind(await hasher.hash(rollbackRaw))
        .first(),
    ).not.toEqual({ consumed_at: null })

    const postCutoverRaw = 'legacy-written-after-cutover'
    await insertLegacyToken(postCutoverRaw, POST_CUTOVER_CREATED_AT, TOKEN_EXPIRES_AT)
    const denied = await app.request(
      `/api/public/session?token=${encodeURIComponent(postCutoverRaw)}`,
      undefined,
      bindings({
        SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: LEGACY_CUTOFF,
      }),
    )
    expect(denied.status).toBe(303)
    expect(denied.headers.get('location')).toBe('/start?access=invalid')
    expect(denied.headers.get('set-cookie')).toBeNull()
  })

  it('stages legacy and purpose writers without ever letting legacy mode emit a purpose', async () => {
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
    const legacyRollout = bindings({
      SUBMITTER_CAPABILITY_WRITER_MODE: 'legacy',
      SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'rollout',
    })
    const start = await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'release-a@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
        }),
      },
      legacyRollout,
    )
    expect(start.status).toBe(202)
    expect(
      await env.DB.prepare(
        'SELECT purpose FROM submitter_tokens ORDER BY created_at DESC, rowid DESC LIMIT 1',
      ).first(),
    ).toEqual({ purpose: null })
    const capture = await latestCapturedBody(env.DB, 'release-a@example.test')
    const raw = decodeURIComponent(capture?.split('token=')[1] ?? '')
    const redeem = await app.request(
      `/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      legacyRollout,
    )
    expect(redeem.status).toBe(303)
    const cookie = /sp_session=([^;]+)/.exec(redeem.headers.get('set-cookie') ?? '')?.[1]
    expect(cookie).toBeTruthy()
    expect(
      await env.DB.prepare('SELECT capability FROM sessions WHERE token_hash = ?')
        .bind(await hasher.hash(cookie ?? ''))
        .first(),
    ).toEqual({ capability: null })

    // Release A's reader understands non-null rows and still enforces them;
    // it is not the old broad reader that becomes a forbidden rollback after B.
    await env.DB.prepare('UPDATE sessions SET capability = ? WHERE token_hash = ?')
      .bind('portal', await hasher.hash(cookie ?? ''))
      .run()
    expect(
      (
        await app.request(
          '/api/public/evaluations',
          { headers: { cookie: cookieHeader(cookie ?? '') } },
          legacyRollout,
        )
      ).status,
    ).toBe(403)

    // During Release B, the purpose writer may co-serve only with Release A's
    // capability-aware reader. It writes purpose while still reading an A row.
    const purposeRollout = bindings({
      SUBMITTER_CAPABILITY_WRITER_MODE: 'purpose',
      SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'rollout',
    })
    await env.DB.prepare('UPDATE sessions SET capability = NULL WHERE token_hash = ?')
      .bind(await hasher.hash(cookie ?? ''))
      .run()
    expect(
      (
        await app.request(
          '/api/public/profile',
          { headers: { cookie: cookieHeader(cookie ?? '') } },
          purposeRollout,
        )
      ).status,
    ).toBe(200)
    await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'release-b@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
        }),
      },
      purposeRollout,
    )
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM submitter_tokens WHERE purpose = 'cfp'",
      ).first(),
    ).toEqual({ count: 1 })
  })

  it('new writers always persist purpose/capability and blank cutoff affects only legacy rows', async () => {
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)

    const cookie = await submitterCookie(env.DB)
    const session = await env.DB.prepare('SELECT capability FROM sessions WHERE token_hash = ?')
      .bind(await hasher.hash(cookie))
      .first<{ capability: string | null }>()
    expect(session).toEqual({ capability: 'cfp' })
    expect(
      await env.DB.prepare(
        'SELECT purpose FROM submitter_tokens ORDER BY created_at DESC, rowid DESC LIMIT 1',
      ).first(),
    ).toEqual({ purpose: 'cfp' })

    await env.DB.prepare(
      'UPDATE sessions SET capability = NULL, created_at = ? WHERE token_hash = ?',
    )
      .bind('2026-08-15T00:00:00.000Z', await hasher.hash(cookie))
      .run()
    const legacyWithoutCutoff = await app.request(
      '/api/public/profile',
      { headers: { cookie: cookieHeader(cookie) } },
      bindings({ SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: '' }),
    )
    expect(legacyWithoutCutoff.status).toBe(401)
  })

  it('rotates a real pre-cutoff legacy session without losing its bounded lineage', async () => {
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-legacy', 'rotate-legacy@example.test', 'Rotate Legacy', LEGACY_CREATED_AT)
      .run()
    const raw = 'legacy-session-to-rotate'
    await env.DB.prepare(
      `INSERT INTO sessions
         (id, kind, contact_id, event_id, capability, token_hash, expires_at, consumed_at, created_at)
       VALUES (?, 'submitter', ?, ?, NULL, ?, ?, NULL, ?)`,
    )
      .bind(
        'legacy-session-to-rotate',
        'contact-legacy',
        DEMO_CONF_2026_ID,
        await hasher.hash(raw),
        SESSION_EXPIRES_AT,
        LEGACY_CREATED_AT,
      )
      .run()

    const deps = buildServerDeps(
      env.DB,
      'https://www.openevents.engineer',
      null,
      TEST_EMAIL_DELIVERY_CONFIG,
      undefined,
      undefined,
      LEGACY_CUTOFF,
    )
    const rotated = await deps.session.rotateSession(raw, 60 * 60 * 1000)
    const validated = await deps.session.validateSession(rotated.token)

    expect(validated).toMatchObject({ capability: null, createdAt: LEGACY_CREATED_AT })
    const actor = validated === null ? null : toSubmitterActor(validated)
    expect(actor).toMatchObject({ capability: null, legacyBroadAuthority: true })
    expect(
      await env.DB.prepare('SELECT capability, created_at FROM sessions WHERE token_hash = ?')
        .bind(await hasher.hash(rotated.token))
        .first(),
    ).toEqual({ capability: null, created_at: LEGACY_CREATED_AT })
  })

  it('denies pre-cutoff legacy tokens and sessions after their distinct horizons', async () => {
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-legacy', 'old-legacy@example.test', 'Old Legacy', LEGACY_CREATED_AT)
      .run()
    const cutoff = new Date(TEST_NOW_MS - 31 * 24 * 60 * 60 * 1000).toISOString()
    const createdAt = new Date(Date.parse(cutoff) - 1).toISOString()
    await insertLegacyToken('old-legacy-token', createdAt, TOKEN_EXPIRES_AT)
    await env.DB.prepare(
      `INSERT INTO sessions
         (id, kind, contact_id, event_id, capability, token_hash, expires_at, consumed_at, created_at)
       VALUES (?, 'submitter', ?, ?, NULL, ?, ?, NULL, ?)`,
    )
      .bind(
        'old-legacy-session',
        'contact-legacy',
        DEMO_CONF_2026_ID,
        await hasher.hash('old-legacy-session'),
        SESSION_EXPIRES_AT,
        createdAt,
      )
      .run()
    const configured = bindings({ SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: cutoff })

    const token = await app.request(
      '/api/public/session?token=old-legacy-token',
      undefined,
      configured,
    )
    expect(token.status).toBe(303)
    expect(token.headers.get('location')).toBe('/start?access=invalid')
    const session = await app.request(
      '/api/public/profile',
      { headers: { cookie: cookieHeader('old-legacy-session') } },
      configured,
    )
    expect(session.status).toBe(401)
  })
})
