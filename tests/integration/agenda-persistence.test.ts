import { beforeEach, describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import { DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { createAgendaRepository, type AgendaSessionRecord } from '../../src/db/agenda-repository'
import { findAgendaConflicts, placeSessions } from '../../src/domain/agenda'
import { applyMigrations, seedDemoConf, splitSqlStatements } from './m2b-helpers'

const NOW = '2026-08-09T12:00:00.000Z'
const DAY = '2026-05-13'
const START = '2026-05-13T09:00:00.000Z'
const END = '2026-05-13T10:00:00.000Z'
const ROOM_MAIN_HALL = 'f0000000-0000-4000-8000-000000000505'
const ROOM_WORKSHOP_A = 'f0000000-0000-4000-8000-000000000506'
const TRACK_WORKSHOP = 'f0000000-0000-4000-8000-000000000503'
const SUBMISSIONS = [
  'submission-1',
  'submission-2',
  'submission-3',
  'submission-4',
  'submission-5',
] as const

/** Future agenda seed fixtures: the two room taxonomy rows (…-0505 main-hall,
 * …-0506 workshop-a), speaker contacts, and FK-valid submissions. */
async function seedAgendaFixtures(db: D1Database): Promise<void> {
  // Seed-idempotent: INSERT OR IGNORE skips the two room rows when the
  // deterministic seed already inserted them, while staying self-contained
  // (the rows are created here when the seed has not landed yet).
  await db
    .prepare(
      `INSERT OR IGNORE INTO taxonomy_items (event_id, id, kind, key, label, position) VALUES
         (?, ?, 'room', 'main-hall', 'Main hall', 0),
         (?, ?, 'room', 'workshop-a', 'Workshop A', 1)`,
    )
    .bind(DEMO_CONF_2026_ID, ROOM_MAIN_HALL, DEMO_CONF_2026_ID, ROOM_WORKSHOP_A)
    .run()
  await db
    .prepare(
      `INSERT INTO contacts (id, email, name, created_at) VALUES
         ('contact-1', 'one@example.test', 'One', ?),
         ('contact-2', 'two@example.test', 'Two', ?)`,
    )
    .bind(NOW, NOW)
    .run()
  for (const [index, submissionId] of SUBMISSIONS.entries()) {
    await db
      .prepare(
        `INSERT INTO proposal_submissions (id, event_id, owner_contact_id, form_version_id,
                                           origin_draft_id, status, title, answers_json,
                                           content_hash, routing_json, created_at, submitted_at)
         VALUES (?, ?, 'contact-1', ?, ?, 'pending', 'Talk', '{"format":"talk"}', ?, NULL, ?, ?)`,
      )
      .bind(
        submissionId,
        DEMO_CONF_2026_ID,
        DEMO_CONF_2026_VERSION_ID,
        `draft-${index + 1}`,
        String.fromCharCode(97 + index).repeat(64),
        NOW,
        NOW,
      )
      .run()
  }
}

function session(
  submissionId: string,
  overrides: Partial<AgendaSessionRecord> = {},
): AgendaSessionRecord {
  return {
    eventId: DEMO_CONF_2026_ID,
    submissionId,
    trackId: null,
    roomId: null,
    day: DAY,
    start: START,
    end: END,
    position: null,
    status: 'draft',
    assignment: 'unassigned',
    speakerIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** Attempts an agenda_sessions insert with a mutated field and asserts the
 * migration CHECK rejects it (base row is FK-valid). */
async function expectSessionInsertRejected(overrides: Record<string, unknown>): Promise<void> {
  const values = {
    event_id: DEMO_CONF_2026_ID,
    submission_id: 'submission-1',
    track_id: null,
    room_id: null,
    day: DAY,
    start: START,
    end: END,
    position: null,
    status: 'draft',
    assignment: 'unassigned',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
  await expect(
    env.DB.prepare(
      `INSERT INTO agenda_sessions (event_id, submission_id, track_id, room_id, day, start, end,
                                     position, status, assignment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        values.event_id,
        values.submission_id,
        values.track_id,
        values.room_id,
        values.day,
        values.start,
        values.end,
        values.position,
        values.status,
        values.assignment,
        values.created_at,
        values.updated_at,
      )
      .run(),
  ).rejects.toThrow()
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
  ])
  await seedDemoConf(env.DB)
  await seedAgendaFixtures(env.DB)
})

describe('agenda persistence', () => {
  it('migration 0006 creates the agenda tables and records the migration', async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('agenda_sessions', 'agenda_session_speakers') ORDER BY name",
    ).all<{ name: string }>()
    expect(tables.results.map((row) => row.name)).toEqual([
      'agenda_session_speakers',
      'agenda_sessions',
    ])
    const migration = await env.DB.prepare(
      "SELECT name FROM d1_migrations WHERE name = '0006_create_agenda_tables.sql'",
    ).first<{ name: string }>()
    expect(migration).toEqual({ name: '0006_create_agenda_tables.sql' })
  })

  it('agenda_sessions CHECKs reject invalid rows', async () => {
    await expectSessionInsertRejected({ status: 'bogus' })
    await expectSessionInsertRejected({ day: '2026/05/13' })
    await expectSessionInsertRejected({ start: 'short' })
    await expectSessionInsertRejected({ end: '2026-05-13T08:00:00.000Z' })
    await expectSessionInsertRejected({ updated_at: '2026-08-09T11:00:00.000Z' })
    await expectSessionInsertRejected({ position: -1 })
    await expectSessionInsertRejected({ assignment: 'scheduled' })
  })

  it('agenda_sessions UNIQUE submission_id rejects a duplicate session row', async () => {
    const insert = (submissionId: string) =>
      env.DB.prepare(
        `INSERT INTO agenda_sessions (event_id, submission_id, day, start, end, status,
                                         assignment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', 'unassigned', ?, ?)`,
      )
        .bind(DEMO_CONF_2026_ID, submissionId, DAY, START, END, NOW, NOW)
        .run()
    await insert('submission-1')
    await expect(insert('submission-1')).rejects.toThrow()
  })

  it('findBySubmission returns null for an unknown submission', async () => {
    const repository = createAgendaRepository(env.DB)
    expect(await repository.findBySubmission(DEMO_CONF_2026_ID, 'no-such-submission')).toBeNull()
  })

  it('saveSession persists a session and its speakers atomically', async () => {
    const repository = createAgendaRepository(env.DB)
    await repository.saveSession(
      session('submission-1', {
        trackId: TRACK_WORKSHOP,
        roomId: ROOM_MAIN_HALL,
        position: 0,
        status: 'published',
        assignment: 'scheduled',
        speakerIds: ['contact-1', 'contact-2'],
      }),
    )

    const found = await repository.findBySubmission(DEMO_CONF_2026_ID, 'submission-1')
    expect(found).toMatchObject({
      eventId: DEMO_CONF_2026_ID,
      submissionId: 'submission-1',
      trackId: TRACK_WORKSHOP,
      roomId: ROOM_MAIN_HALL,
      day: DAY,
      start: START,
      end: END,
      position: 0,
      status: 'published',
      assignment: 'scheduled',
      speakerIds: ['contact-1', 'contact-2'],
    })
    expect(await repository.listByEvent(DEMO_CONF_2026_ID)).toHaveLength(1)
  })

  it('saveSession replaces speakers on re-save (speaker sync)', async () => {
    const repository = createAgendaRepository(env.DB)
    await repository.saveSession(
      session('submission-1', { speakerIds: ['contact-1', 'contact-2'] }),
    )
    await repository.saveSession(session('submission-1', { speakerIds: ['contact-2'] }))
    expect(
      (await repository.findBySubmission(DEMO_CONF_2026_ID, 'submission-1'))?.speakerIds,
    ).toEqual(['contact-2'])
    await repository.saveSession(session('submission-1', { speakerIds: [] }))
    expect(
      (await repository.findBySubmission(DEMO_CONF_2026_ID, 'submission-1'))?.speakerIds,
    ).toEqual([])
  })

  it('stores an identical-slot room double booking so the conflict stays reportable', async () => {
    const repository = createAgendaRepository(env.DB)
    const booked = { roomId: ROOM_MAIN_HALL, assignment: 'scheduled' } as const
    await repository.saveSession(session('submission-1', { ...booked, position: 0 }))
    await repository.saveSession(session('submission-2', { ...booked, position: 1 }))

    // The UNIQUE (event_id, room_id, day, start, end, position) key scopes
    // uniqueness to the position, so one room can hold two sessions on one
    // slot: the double booking is storable, and the domain reports it.
    const stored = await repository.listByEvent(DEMO_CONF_2026_ID)
    expect(stored.map((row) => row.submissionId)).toEqual(['submission-1', 'submission-2'])
    const placements = placeSessions({
      sessions: stored.map((row) => ({ ...row, speakerIds: row.speakerIds })),
      rooms: [ROOM_MAIN_HALL],
      tracks: [],
    })
    expect(findAgendaConflicts(placements)).toEqual([
      { kind: 'room', first: 'submission-1', second: 'submission-2' },
    ])

    // The same room, slot AND position is the one combination it rejects.
    await expect(
      repository.saveSession(session('submission-3', { ...booked, position: 1 })),
    ).rejects.toThrow()
  })

  it('listByEvent orders deterministically by day, start, position, room_id, submission_id', async () => {
    const repository = createAgendaRepository(env.DB)
    await repository.saveSession(
      session('submission-1', { roomId: ROOM_MAIN_HALL, position: 0, assignment: 'scheduled' }),
    )
    await repository.saveSession(
      session('submission-2', { roomId: ROOM_WORKSHOP_A, position: 0, assignment: 'scheduled' }),
    )
    await repository.saveSession(
      session('submission-3', { roomId: ROOM_MAIN_HALL, position: 1, assignment: 'scheduled' }),
    )
    await repository.saveSession(
      session('submission-4', {
        day: '2026-05-14',
        start: '2026-05-14T09:00:00.000Z',
        end: '2026-05-14T10:00:00.000Z',
      }),
    )
    await repository.saveSession(
      session('submission-5', {
        day: '2026-05-14',
        start: '2026-05-14T09:00:00.000Z',
        end: '2026-05-14T10:00:00.000Z',
      }),
    )

    const listed = await repository.listByEvent(DEMO_CONF_2026_ID)
    expect(listed.map((row) => row.submissionId)).toEqual([
      'submission-1',
      'submission-2',
      'submission-3',
      'submission-4',
      'submission-5',
    ])
  })
})
