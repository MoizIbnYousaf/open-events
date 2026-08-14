import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import {
  DEMO_CONF_2026_CRITERION_ID,
  DEMO_CONF_2026_ID,
  DEMO_CONF_2026_REVIEWER_ONE_ID,
  DEMO_CONF_2026_REVIEWER_TWO_ID,
  DEMO_CONF_2026_ROUND_ID,
  DEMO_CONF_2026_VERSION_ID,
} from '../../src/db'
import { applyMigrations, countRows, expectRejects, seedDemoConf } from './m2b-helpers'

// Evaluation storage contract (migration 0010): event-scoped criteria and
// rounds, assignments that pin one evaluator to one submission for one round,
// and scores that hang off an assignment. Ids are globally unique per the 0004
// convention and every child reaches its parent through a composite
// (event_id, ...) foreign key, so no row can straddle two events.

const NOW = '2026-08-10T09:00:00.000Z'
const SUBMISSION_ID = 'submission-eval-1'
const OTHER_EVENT_ID = 'event-other-conf'
const OTHER_SUBMISSION_ID = 'submission-eval-other'

async function insertSubmission(
  eventId: string,
  submissionId: string,
  formVersionId = DEMO_CONF_2026_VERSION_ID,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO contacts (id, email, name, created_at)
     VALUES (?, ?, 'Speaker', ?) ON CONFLICT(email) DO NOTHING`,
  )
    .bind(`contact-${eventId}`, `owner-${eventId}@example.test`, NOW)
    .run()
  await env.DB.prepare(
    `INSERT INTO proposal_submissions
       (id, event_id, owner_contact_id, form_version_id, origin_draft_id, status,
        title, answers_json, content_hash, routing_json, created_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, 'pending',
             'Evaluated proposal', '{}', ?, NULL, ?, ?)`,
  )
    .bind(
      submissionId,
      eventId,
      `contact-${eventId}`,
      formVersionId,
      `draft-${submissionId}`,
      'a'.repeat(64),
      NOW,
      NOW,
    )
    .run()
}

async function insertAssignment(
  id: string,
  eventId: string,
  roundId: string,
  submissionId: string,
  evaluatorContactId: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO evaluation_assignments
       (event_id, id, round_id, submission_id, evaluator_contact_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(eventId, id, roundId, submissionId, evaluatorContactId, NOW)
    .run()
}

async function insertScore(
  id: string,
  assignmentId: string,
  criterionId: string,
  rating: number,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO evaluation_scores
       (event_id, id, assignment_id, criterion_id, rating, comment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(DEMO_CONF_2026_ID, id, assignmentId, criterionId, rating, NOW, NOW)
    .run()
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
  await insertSubmission(DEMO_CONF_2026_ID, SUBMISSION_ID)
})

describe('migration 0010 evaluation tables', () => {
  it('records the migration and creates every evaluation table', async () => {
    const migration = await env.DB.prepare(
      "SELECT name FROM d1_migrations WHERE name = '0010_create_evaluation_tables.sql'",
    ).first()
    expect(migration).toEqual({ name: '0010_create_evaluation_tables.sql' })

    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>()
    const names = tables.results.map((row) => row.name)
    for (const table of [
      'evaluation_criteria',
      'evaluation_rounds',
      'evaluation_assignments',
      'evaluation_scores',
      'evaluation_committee_members',
    ]) {
      expect(names).toContain(table)
    }
  })

  it('keeps a committee membership inside one event and refuses a duplicate', async () => {
    await env.DB.prepare('INSERT INTO events (id, slug, name, timezone, status) VALUES (?,?,?,?,?)')
      .bind(OTHER_EVENT_ID, 'other-conf', 'Other Conf', 'Europe/Berlin', 'draft')
      .run()

    // Membership is per event: the same contact reviewing two events is two
    // rows, and neither implies the other.
    await env.DB.prepare(
      'INSERT INTO evaluation_committee_members (event_id, contact_id, added_at) VALUES (?,?,?)',
    )
      .bind(OTHER_EVENT_ID, DEMO_CONF_2026_REVIEWER_ONE_ID, NOW)
      .run()

    await expectRejects(
      env.DB,
      'INSERT INTO evaluation_committee_members (event_id, contact_id, added_at) VALUES (?,?,?)',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_REVIEWER_ONE_ID,
      NOW,
    )

    await expectRejects(
      env.DB,
      'INSERT INTO evaluation_committee_members (event_id, contact_id, added_at) VALUES (?,?,?)',
      DEMO_CONF_2026_ID,
      'contact-does-not-exist',
      NOW,
    )
  })

  it('keeps every evaluation id globally unique across events', async () => {
    await env.DB.prepare('INSERT INTO events (id, slug, name, timezone, status) VALUES (?,?,?,?,?)')
      .bind(OTHER_EVENT_ID, 'other-conf', 'Other Conf', 'Europe/Berlin', 'draft')
      .run()

    await expectRejects(
      env.DB,
      'INSERT INTO evaluation_criteria (event_id, id, name, weight, position) VALUES (?,?,?,?,?)',
      OTHER_EVENT_ID,
      DEMO_CONF_2026_CRITERION_ID,
      'Overall fit',
      1,
      0,
    )
    await expectRejects(
      env.DB,
      'INSERT INTO evaluation_rounds (event_id, id, number, name, status) VALUES (?,?,?,?,?)',
      OTHER_EVENT_ID,
      DEMO_CONF_2026_ROUND_ID,
      1,
      'Round 1',
      'open',
    )
  })

  it('rejects a rating outside the one to five scale', async () => {
    await insertAssignment(
      'assignment-1',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_ROUND_ID,
      SUBMISSION_ID,
      DEMO_CONF_2026_REVIEWER_ONE_ID,
    )

    for (const rating of [0, 6, -1]) {
      await expectRejects(
        env.DB,
        `INSERT INTO evaluation_scores
           (event_id, id, assignment_id, criterion_id, rating, comment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        DEMO_CONF_2026_ID,
        `score-${rating}`,
        'assignment-1',
        DEMO_CONF_2026_CRITERION_ID,
        rating,
        NOW,
        NOW,
      )
    }
    expect(await countRows(env.DB, 'evaluation_scores')).toBe(0)
  })

  it('rejects a zero criterion weight, a negative position and an unknown round status', async () => {
    await expectRejects(
      env.DB,
      'INSERT INTO evaluation_criteria (event_id, id, name, weight, position) VALUES (?,?,?,?,?)',
      DEMO_CONF_2026_ID,
      'criterion-zero-weight',
      'Zero weight',
      0,
      1,
    )
    await expectRejects(
      env.DB,
      'INSERT INTO evaluation_criteria (event_id, id, name, weight, position) VALUES (?,?,?,?,?)',
      DEMO_CONF_2026_ID,
      'criterion-negative-position',
      'Negative position',
      1,
      -1,
    )
    await expectRejects(
      env.DB,
      'INSERT INTO evaluation_rounds (event_id, id, number, name, status) VALUES (?,?,?,?,?)',
      DEMO_CONF_2026_ID,
      'round-paused',
      2,
      'Round 2',
      'paused',
    )
  })

  it('allows one assignment per round, submission and evaluator', async () => {
    await insertAssignment(
      'assignment-1',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_ROUND_ID,
      SUBMISSION_ID,
      DEMO_CONF_2026_REVIEWER_ONE_ID,
    )

    await expectRejects(
      env.DB,
      `INSERT INTO evaluation_assignments
         (event_id, id, round_id, submission_id, evaluator_contact_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      DEMO_CONF_2026_ID,
      'assignment-duplicate',
      DEMO_CONF_2026_ROUND_ID,
      SUBMISSION_ID,
      DEMO_CONF_2026_REVIEWER_ONE_ID,
      NOW,
    )
    expect(await countRows(env.DB, 'evaluation_assignments')).toBe(1)

    await insertAssignment(
      'assignment-2',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_ROUND_ID,
      SUBMISSION_ID,
      DEMO_CONF_2026_REVIEWER_TWO_ID,
    )
    expect(await countRows(env.DB, 'evaluation_assignments')).toBe(2)
  })

  it('allows one score per assignment and criterion', async () => {
    await insertAssignment(
      'assignment-1',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_ROUND_ID,
      SUBMISSION_ID,
      DEMO_CONF_2026_REVIEWER_ONE_ID,
    )
    await insertScore('score-1', 'assignment-1', DEMO_CONF_2026_CRITERION_ID, 4)

    await expectRejects(
      env.DB,
      `INSERT INTO evaluation_scores
         (event_id, id, assignment_id, criterion_id, rating, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      DEMO_CONF_2026_ID,
      'score-duplicate',
      'assignment-1',
      DEMO_CONF_2026_CRITERION_ID,
      5,
      NOW,
      NOW,
    )
    expect(await countRows(env.DB, 'evaluation_scores')).toBe(1)
  })

  it('refuses to reopen a closed review round', async () => {
    await env.DB.prepare(
      "UPDATE evaluation_rounds SET status = 'closed' WHERE event_id = ? AND id = ?",
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_ROUND_ID)
      .run()

    await expectRejects(
      env.DB,
      "UPDATE evaluation_rounds SET status = 'open' WHERE event_id = ? AND id = ?",
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_ROUND_ID,
    )

    const round = await env.DB.prepare('SELECT status FROM evaluation_rounds WHERE id = ?')
      .bind(DEMO_CONF_2026_ROUND_ID)
      .first<{ status: string }>()
    expect(round?.status).toBe('closed')
  })

  it('lets a closed round be renamed and re-snapshotted without reopening it', async () => {
    await env.DB.prepare(
      "UPDATE evaluation_rounds SET status = 'closed', weights_json = ? WHERE event_id = ? AND id = ?",
    )
      .bind(
        JSON.stringify([{ criterionId: DEMO_CONF_2026_CRITERION_ID, weight: 1 }]),
        DEMO_CONF_2026_ID,
        DEMO_CONF_2026_ROUND_ID,
      )
      .run()

    await env.DB.prepare('UPDATE evaluation_rounds SET name = ? WHERE id = ?')
      .bind('First round', DEMO_CONF_2026_ROUND_ID)
      .run()

    const round = await env.DB.prepare(
      'SELECT name, status, weights_json FROM evaluation_rounds WHERE id = ?',
    )
      .bind(DEMO_CONF_2026_ROUND_ID)
      .first<{ name: string; status: string; weights_json: string | null }>()
    expect(round?.name).toBe('First round')
    expect(round?.status).toBe('closed')
    expect(JSON.parse(round?.weights_json ?? 'null')).toEqual([
      { criterionId: DEMO_CONF_2026_CRITERION_ID, weight: 1 },
    ])
  })

  it('refuses an assignment that straddles two events', async () => {
    await env.DB.prepare('INSERT INTO events (id, slug, name, timezone, status) VALUES (?,?,?,?,?)')
      .bind(OTHER_EVENT_ID, 'other-conf', 'Other Conf', 'Europe/Berlin', 'draft')
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                              opens_at, closes_at, total_cap, per_identity_limit)
       VALUES (?, 'form-other', 'cfp', 'draft', NULL, NULL, NULL, NULL, NULL)`,
    )
      .bind(OTHER_EVENT_ID)
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, id, form_id, version, status,
                                      content_hash, published_at, updated_at)
       VALUES (?, 'version-other', 'form-other', 1, 'draft', NULL, NULL, ?)`,
    )
      .bind(OTHER_EVENT_ID, NOW)
      .run()
    await insertSubmission(OTHER_EVENT_ID, OTHER_SUBMISSION_ID, 'version-other')

    // The demo round with a submission from the other event.
    await expectRejects(
      env.DB,
      `INSERT INTO evaluation_assignments
         (event_id, id, round_id, submission_id, evaluator_contact_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      DEMO_CONF_2026_ID,
      'assignment-cross-event',
      DEMO_CONF_2026_ROUND_ID,
      OTHER_SUBMISSION_ID,
      DEMO_CONF_2026_REVIEWER_ONE_ID,
      NOW,
    )
    // The other event's submission with the demo event's round.
    await expectRejects(
      env.DB,
      `INSERT INTO evaluation_assignments
         (event_id, id, round_id, submission_id, evaluator_contact_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      OTHER_EVENT_ID,
      'assignment-cross-round',
      DEMO_CONF_2026_ROUND_ID,
      OTHER_SUBMISSION_ID,
      DEMO_CONF_2026_REVIEWER_ONE_ID,
      NOW,
    )
    expect(await countRows(env.DB, 'evaluation_assignments')).toBe(0)
  })
})

describe('DemoConf 2026 committee seed', () => {
  it('seeds two reviewer contacts, one default criterion and one open round', async () => {
    const reviewers = await env.DB.prepare(
      'SELECT id, email, name FROM contacts WHERE email LIKE ? ORDER BY email',
    )
      .bind('reviewer.%@example.test')
      .all<{ id: string; email: string; name: string }>()
    expect(reviewers.results).toEqual([
      {
        id: DEMO_CONF_2026_REVIEWER_ONE_ID,
        email: 'reviewer.one@example.test',
        name: 'Reviewer One',
      },
      {
        id: DEMO_CONF_2026_REVIEWER_TWO_ID,
        email: 'reviewer.two@example.test',
        name: 'Reviewer Two',
      },
    ])

    // Ordering is part of the repository contract (criteria by position/name,
    // rounds by number), so these reads name it rather than trusting storage
    // order to stay accidentally right when a second row is seeded.
    const criterion = await env.DB.prepare(
      'SELECT * FROM evaluation_criteria WHERE event_id = ? ORDER BY position, name',
    )
      .bind(DEMO_CONF_2026_ID)
      .first()
    expect(criterion).toEqual({
      event_id: DEMO_CONF_2026_ID,
      id: DEMO_CONF_2026_CRITERION_ID,
      name: 'Overall fit',
      weight: 1,
      position: 0,
    })

    const round = await env.DB.prepare(
      'SELECT * FROM evaluation_rounds WHERE event_id = ? ORDER BY number',
    )
      .bind(DEMO_CONF_2026_ID)
      .first()
    expect(round).toEqual({
      event_id: DEMO_CONF_2026_ID,
      id: DEMO_CONF_2026_ROUND_ID,
      number: 1,
      name: 'Round 1',
      status: 'open',
      weights_json: null,
      // Migration 0017 added the round's own configuration. The seeded round
      // predates it and reads as undated and not anonymized — the columns
      // exist so an organizer CAN configure a round, not so every round must.
      opens_at: null,
      closes_at: null,
      anonymize: 0,
    })
  })

  it('seeds every identity the frozen demo names', async () => {
    // Scoped to the named cast: the suite's own fixtures create contacts of
    // their own, and this is about who the seed guarantees, not who exists.
    const cast = await env.DB.prepare(
      `SELECT email FROM contacts
        WHERE email IN (?, ?, ?, ?, ?) ORDER BY email`,
    )
      .bind(
        'organizer@example.test',
        'reviewer.one@example.test',
        'reviewer.two@example.test',
        'speaker.ada@example.test',
        'speaker.grace@example.test',
      )
      .all<{ email: string }>()
    expect(cast.results.map((row) => row.email)).toEqual([
      'organizer@example.test',
      'reviewer.one@example.test',
      'reviewer.two@example.test',
      'speaker.ada@example.test',
      'speaker.grace@example.test',
    ])
  })

  it('seats both reviewers on the standing committee', async () => {
    const members = await env.DB.prepare(
      `SELECT c.email AS email FROM evaluation_committee_members m
         JOIN contacts c ON c.id = m.contact_id
        WHERE m.event_id = ? ORDER BY c.email`,
    )
      .bind(DEMO_CONF_2026_ID)
      .all<{ email: string }>()
    expect(members.results.map((row) => row.email)).toEqual([
      'reviewer.one@example.test',
      'reviewer.two@example.test',
    ])
  })

  it('is idempotent on a repeated seed and starts with no assignments or scores', async () => {
    await seedDemoConf(env.DB)
    await seedDemoConf(env.DB)

    expect(await countRows(env.DB, 'evaluation_criteria')).toBe(1)
    expect(await countRows(env.DB, 'evaluation_rounds')).toBe(1)
    expect(await countRows(env.DB, 'evaluation_assignments')).toBe(0)
    expect(await countRows(env.DB, 'evaluation_scores')).toBe(0)
    expect(await countRows(env.DB, 'evaluation_committee_members')).toBe(2)
  })
})
