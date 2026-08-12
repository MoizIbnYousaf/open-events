import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import app from '../../src/server'
import { handleGetPublicSchedule } from '../../src/server/routes/schedule'
import { DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { applyMigrations, seedDemoConf, splitSqlStatements } from './m2b-helpers'
import { bindings } from './m2c-helpers'

// Public schedule API contract: public GET /api/public/events/:slug/schedule,
// uniform 404 for an unknown event, published-only PII-stripped envelope
// { timezone, sessions } with track/room LABELS, Cache-Control: public,
// max-age=60, and no statements beyond the schedule read. The route is
// registered in registerPublicRoutes and exercised through the application.

const NOW = '2026-08-09T12:00:00.000Z'
const ROOM_MAIN_HALL = 'f0000000-0000-4000-8000-000000000505'
const ROOM_WORKSHOP_A = 'f0000000-0000-4000-8000-000000000506'
const TRACK_TALK = 'f0000000-0000-4000-8000-000000000504'
const TRACK_WORKSHOP = 'f0000000-0000-4000-8000-000000000503'
const SCHEDULE_PATH = '/api/public/events/demo-conf-2026/schedule'

async function seedScheduleFixtures(db: D1Database): Promise<void> {
  // Room taxonomy rows (…-0505 main-hall, …-0506 workshop-a) are provided by
  // the seed data (src/db/seed.sql:24-25) — the fixture does not re-insert
  // them. Contacts, submissions, sessions, and speakers are fixture-owned.
  await db
    .prepare(
      `INSERT INTO contacts (id, email, name, created_at) VALUES
         ('contact-1', 'speaker.a@example.test', 'Speaker A', ?),
         ('contact-2', 'speaker.b@example.test', 'Speaker B', ?)`,
    )
    .bind(NOW, NOW)
    .run()
  for (const [index, submissionId] of ['submission-1', 'submission-2'].entries()) {
    await db
      .prepare(
        `INSERT INTO proposal_submissions (id, event_id, owner_contact_id, form_version_id,
                                           origin_draft_id, status, title, answers_json,
                                           content_hash, routing_json, created_at, submitted_at)
         VALUES (?, ?, 'contact-1', ?, ?, 'pending', ?, '{"format":"talk"}', ?, NULL, ?, ?)`,
      )
      .bind(
        submissionId,
        DEMO_CONF_2026_ID,
        DEMO_CONF_2026_VERSION_ID,
        `draft-${index + 1}`,
        index === 0 ? 'My talk' : 'Hands-on workshop',
        String.fromCharCode(97 + index).repeat(64),
        NOW,
        NOW,
      )
      .run()
  }
  const insertSession = (values: unknown[]) =>
    db
      .prepare(
        `INSERT INTO agenda_sessions (event_id, submission_id, track_id, room_id, day, start, end,
                                       position, status, assignment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(...values)
      .run()
  await insertSession([
    DEMO_CONF_2026_ID,
    'submission-1',
    TRACK_TALK,
    ROOM_MAIN_HALL,
    '2026-05-13',
    '2026-05-13T09:00:00.000Z',
    '2026-05-13T10:00:00.000Z',
    0,
    'published',
    'scheduled',
    NOW,
    NOW,
  ])
  // Draft session: must never appear in the public schedule.
  await insertSession([
    DEMO_CONF_2026_ID,
    'submission-2',
    TRACK_WORKSHOP,
    ROOM_WORKSHOP_A,
    '2026-05-20',
    '2026-05-20T09:00:00.000Z',
    '2026-05-20T12:00:00.000Z',
    0,
    'draft',
    'unassigned',
    NOW,
    NOW,
  ])
  await db
    .prepare(
      `INSERT INTO agenda_session_speakers (event_id, submission_id, contact_id)
       VALUES (?, 'submission-1', 'contact-1')`,
    )
    .bind(DEMO_CONF_2026_ID)
    .run()
}

/** Read-only statement recorder: wraps the pool D1 binding via the bindings
 * override seam so the schedule read can be pinned to SELECTs only. */
function countingDb(statements: string[]): D1Database {
  const wrapped = {
    ...env.DB,
    prepare: (sql: string) => {
      statements.push(sql)
      return env.DB.prepare(sql)
    },
  } as unknown as D1Database
  return wrapped
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
  ])
  await seedDemoConf(env.DB)
  await seedScheduleFixtures(env.DB)
})

describe('public schedule API', () => {
  it('exposes the schedule handler surface', () => {
    expect(handleGetPublicSchedule).toBeTypeOf('function')
  })

  it('returns the published-only PII-stripped schedule envelope with label track/room', async () => {
    const response = await app.request(SCHEDULE_PATH, undefined, bindings())

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      timezone: string
      sessions: Array<Record<string, unknown>>
    }
    expect(body.timezone).toBe('Europe/Berlin')
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0]).toEqual({
      submissionId: 'submission-1',
      title: 'My talk',
      track: 'AI Engineering',
      room: 'Main hall',
      day: '2026-05-13',
      start: '2026-05-13T09:00:00.000Z',
      end: '2026-05-13T10:00:00.000Z',
      position: 0,
    })
    for (const session of body.sessions) {
      expect(session).not.toHaveProperty('email')
      expect(session).not.toHaveProperty('contactId')
      expect(session).not.toHaveProperty('speakerIds')
      expect(session).not.toHaveProperty('ownerContactId')
    }
    const rendered = JSON.stringify(body)
    expect(rendered).not.toContain('speaker.a@example.test')
    expect(rendered).not.toContain('speaker.b@example.test')
    expect(rendered).not.toContain('contact-1')
  })

  it('hides draft agenda sessions from the public schedule', async () => {
    const response = await app.request(SCHEDULE_PATH, undefined, bindings())
    const body = (await response.json()) as { sessions: Array<{ submissionId: string }> }

    expect(body.sessions.map((session) => session.submissionId)).toEqual(['submission-1'])
    expect(JSON.stringify(body)).not.toContain('submission-2')
  })

  it('returns a uniform 404 for an unknown event slug', async () => {
    const response = await app.request(
      '/api/public/events/no-such-event/schedule',
      undefined,
      bindings(),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } })
  })

  it('pins Cache-Control: public, max-age=60', async () => {
    const response = await app.request(SCHEDULE_PATH, undefined, bindings())

    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
  })

  it('issues only read statements for the schedule read', async () => {
    const statements: string[] = []
    const response = await app.request(
      SCHEDULE_PATH,
      undefined,
      bindings({ DB: countingDb(statements) }),
    )

    expect(response.status).toBe(200)
    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) {
      expect(statement.trim().toUpperCase().startsWith('SELECT')).toBe(true)
    }
  })
})
