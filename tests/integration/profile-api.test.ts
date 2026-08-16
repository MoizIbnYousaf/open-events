import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import migration0013Sql from '../../migrations/0013_add_contact_bio.sql?raw'
import app from '../../src/server'
import { applyMigrations, seedDemoConf, splitSqlStatements } from './m2b-helpers'
import { ALLOWED_ORIGIN, bindings, cookieHeader, submitterPortalCookie } from './m2c-helpers'

// O3 P1 API contract (REQ-006): GET/PUT /api/public/profile serve exactly the
// calling speaker's persisted name/email/bio. Migration 0013 is additive.
// Anonymous access gets the standard envelope; another speaker can neither
// read nor write this profile; email never changes.

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    { name: '0013_add_contact_bio.sql', queries: splitSqlStatements(migration0013Sql) },
  ])
  await seedDemoConf(env.DB)
})

async function getProfile(cookie?: string): Promise<Response> {
  return app.request(
    '/api/public/profile',
    cookie === undefined ? undefined : { headers: { cookie: cookieHeader(cookie) } },
    bindings(),
  )
}

async function putProfile(cookie: string, body: unknown): Promise<Response> {
  return app.request(
    '/api/public/profile',
    {
      method: 'PUT',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    bindings(),
  )
}

describe('migration 0013', () => {
  it('adds a nullable bio column and records itself', async () => {
    const migration = await env.DB.prepare(
      "SELECT name FROM d1_migrations WHERE name = '0013_add_contact_bio.sql'",
    ).first<{ name: string }>()
    expect(migration).toEqual({ name: '0013_add_contact_bio.sql' })
    const columns = await env.DB.prepare('PRAGMA table_info(contacts)').all<{ name: string }>()
    expect(columns.results.map((column) => column.name)).toContain('bio')
  })
})

describe('speaker profile API', () => {
  it('rejects anonymous reads and writes with the standard envelope', async () => {
    const read = await getProfile()
    expect(read.status).toBe(401)
    expect(Object.keys((await read.json()) as Record<string, unknown>)).toEqual(['error'])
  })

  it('round-trips the own profile and persists the bio', async () => {
    const speaker = await submitterPortalCookie(env.DB)
    const before = await getProfile(speaker)
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as { name: string; email: string; bio: string | null }
    expect(beforeBody.email).toBe('speaker-a@example.test')
    expect(beforeBody.bio).toBeNull()

    const update = await putProfile(speaker, { name: 'Ada Lovelace', bio: 'First programmer.' })
    expect(update.status).toBe(200)
    expect(await update.json()).toEqual({
      name: 'Ada Lovelace',
      email: 'speaker-a@example.test',
      bio: 'First programmer.',
      jobTitle: '',
      company: '',
    })

    const stored = await env.DB.prepare('SELECT name, bio FROM contacts WHERE email = ?')
      .bind('speaker-a@example.test')
      .first<{ name: string; bio: string | null }>()
    expect(stored).toEqual({ name: 'Ada Lovelace', bio: 'First programmer.' })
  })

  it('keeps profiles speaker-scoped: another session sees only its own row', async () => {
    const ada = await submitterPortalCookie(env.DB)
    await putProfile(ada, { name: 'Ada', bio: 'Ada private bio' })

    const grace = await submitterPortalCookie(env.DB, {}, 'speaker.grace@example.test')
    const graceRead = await getProfile(grace)
    expect(graceRead.status).toBe(200)
    const graceBody = (await graceRead.json()) as { email: string; bio: string | null }
    expect(graceBody.email).toBe('speaker.grace@example.test')
    expect(graceBody.bio).toBeNull()
    expect(JSON.stringify(graceBody)).not.toContain('Ada private bio')

    await putProfile(grace, { name: 'Grace', bio: 'Grace bio' })
    const adaAfter = (await (await getProfile(ada)).json()) as { name: string; bio: string | null }
    expect(adaAfter).toMatchObject({ name: 'Ada', bio: 'Ada private bio' })
  })

  it('rejects invalid payloads without persisting and never changes email', async () => {
    const speaker = await submitterPortalCookie(env.DB)
    expect((await putProfile(speaker, { name: '', bio: 'x' })).status).toBe(400)
    expect((await putProfile(speaker, { name: 'Ada', bio: 'x'.repeat(2001) })).status).toBe(400)
    expect(
      (await putProfile(speaker, { name: 'Ada', bio: 'ok', email: 'evil@example.test' })).status,
    ).toBe(400)

    const stored = await env.DB.prepare('SELECT name, email FROM contacts WHERE email = ?')
      .bind('speaker-a@example.test')
      .first<{ name: string; email: string }>()
    expect(stored?.email).toBe('speaker-a@example.test')
  })

  it('refuses a write without the CSRF origin', async () => {
    const speaker = await submitterPortalCookie(env.DB)
    const response = await app.request(
      '/api/public/profile',
      {
        method: 'PUT',
        headers: { cookie: cookieHeader(speaker), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada', bio: null }),
      },
      bindings(),
    )
    expect(response.status).toBe(403)
  })
})
