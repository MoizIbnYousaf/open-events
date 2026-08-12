import { describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import { migrationsUpTo } from './m2b-helpers'

/**
 * Migration 0018 as an UPGRADE from a database that already ran 0017.
 *
 * 0017 is committed and may already be applied, so the fix could not be an edit
 * to it: a deployment that ran 0017 holds answer rows under the old foreign key
 * and has to reach the corrected shape without losing them. 0018 rebuilds the
 * table, which means every index and constraint it carried has to come back —
 * `DROP TABLE` takes them along, and losing one silently would be a worse defect
 * than the one being fixed.
 *
 * The bug: saving a scorecard replaces its questions wholesale, and a recorded
 * answer points at the question row it answered. Without a cascade the replace is
 * refused the moment the first reviewer answers, and the scorecard becomes
 * permanently uneditable.
 */
const EVENT = 'cccccccc-0000-4000-8000-0000000000ca'
const ROUND = 'cccccccc-0000-4000-8000-0000000000cb'
const CRITERION = 'cccccccc-0000-4000-8000-0000000000cc'
const SUBMISSION = 'cccccccc-0000-4000-8000-0000000000cd'
const CONTACT = 'cccccccc-0000-4000-8000-0000000000ce'
const ASSIGNMENT = 'cccccccc-0000-4000-8000-0000000000cf'
const SCORE = 'cccccccc-0000-4000-8000-0000000000d0'
const NOW = '2026-08-12T09:00:00.000Z'

/** The minimum graph an answer row needs, written against the 0017 schema. */
async function populatePre0018(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at,
       website_url, organizer_contact, venue, event_type)
     VALUES (?, 'cascade-upgrade', 'Cascade Upgrade', 'UTC', 'draft',
       '2026-05-13T08:00:00.000Z', '2026-05-15T17:00:00.000Z',
       'https://example.test/c', 'programme@example.test', 'Venue', 'conference')`,
  )
    .bind(EVENT)
    .run()
  await env.DB.prepare(
    `INSERT INTO contacts (id, email, name, created_at) VALUES (?, 'rev@example.test', 'Rev', ?)`,
  )
    .bind(CONTACT, NOW)
    .run()
  await env.DB.prepare(
    `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
       opens_at, closes_at, total_cap, per_identity_limit)
     VALUES (?, 'form-c', 'cfp', 'draft', NULL, NULL, NULL, NULL, NULL)`,
  )
    .bind(EVENT)
    .run()
  await env.DB.prepare(
    `INSERT INTO cfp_form_versions (event_id, id, form_id, version, status,
       content_hash, published_at, updated_at)
     VALUES (?, 'version-c', 'form-c', 1, 'draft', NULL, NULL, ?)`,
  )
    .bind(EVENT, NOW)
    .run()
  await env.DB.prepare(
    `INSERT INTO proposal_submissions (id, event_id, owner_contact_id, form_version_id,
       origin_draft_id, status, title, answers_json, content_hash, routing_json,
       created_at, submitted_at)
     VALUES (?, ?, ?, 'version-c', 'draft-c', 'pending', 'A proposal', '{}', ?, NULL, ?, ?)`,
  )
    .bind(SUBMISSION, EVENT, CONTACT, 'a'.repeat(64), NOW, NOW)
    .run()
  await env.DB.prepare(
    `INSERT INTO evaluation_rounds (event_id, id, number, name, status)
     VALUES (?, ?, 1, 'Round 1', 'open')`,
  )
    .bind(EVENT, ROUND)
    .run()
  await env.DB.prepare(
    `INSERT INTO evaluation_round_criteria
       (event_id, id, round_id, position, label, kind, weight, config_json)
     VALUES (?, ?, ?, 0, 'Originality', 'rating', 2, '{"scale":{"min":1,"max":5}}')`,
  )
    .bind(EVENT, CRITERION, ROUND)
    .run()
  await env.DB.prepare(
    `INSERT INTO evaluation_assignments (event_id, id, round_id, submission_id,
       evaluator_contact_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(EVENT, ASSIGNMENT, ROUND, SUBMISSION, CONTACT, NOW)
    .run()
  await env.DB.prepare(
    `INSERT INTO evaluation_round_scores (event_id, id, assignment_id, criterion_id,
       value_number, value_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, 4, NULL, ?, ?)`,
  )
    .bind(EVENT, SCORE, ASSIGNMENT, CRITERION, NOW, NOW)
    .run()
}

const deleteCriterion = () =>
  env.DB.prepare(`DELETE FROM evaluation_round_criteria WHERE event_id = ? AND id = ?`)
    .bind(EVENT, CRITERION)
    .run()

describe('migration 0018 upgrades a database that already ran 0017', () => {
  it('preserves recorded answers and makes an answered scorecard replaceable', async () => {
    await reset()
    await applyD1Migrations(env.DB, migrationsUpTo('0017_configurable_review_rounds.sql'))
    await populatePre0018()

    // The defect is genuinely present before the upgrade: replacing a question
    // that has been answered is refused.
    await expect(deleteCriterion()).rejects.toThrow(/FOREIGN KEY/i)

    const before = await env.DB.prepare(
      `SELECT event_id, id, assignment_id, criterion_id, value_number, value_text,
              created_at, updated_at
         FROM evaluation_round_scores ORDER BY id`,
    ).all<Record<string, unknown>>()
    expect(before.results).toHaveLength(1)

    await applyD1Migrations(env.DB, migrationsUpTo('0018_cascade_round_scores_to_criteria.sql'))

    // Column-for-column, not merely the same count: a reviewer's recorded score
    // must survive the rebuild exactly.
    const after = await env.DB.prepare(
      `SELECT event_id, id, assignment_id, criterion_id, value_number, value_text,
              created_at, updated_at
         FROM evaluation_round_scores ORDER BY id`,
    ).all<Record<string, unknown>>()
    expect(after.results).toEqual(before.results)

    // And the replace the old shape refused now succeeds, taking its answers with it.
    await deleteCriterion()
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM evaluation_round_scores WHERE criterion_id = ?`,
    )
      .bind(CRITERION)
      .first<{ n: number }>()
    expect(remaining?.n).toBe(0)
  })

  it('keeps every constraint the rebuilt table carried', async () => {
    await reset()
    await applyD1Migrations(env.DB, migrationsUpTo('0018_cascade_round_scores_to_criteria.sql'))
    await populatePre0018()

    // One answer per criterion per assignment: re-scoring edits rather than
    // accumulates, and this uniqueness is what makes that true.
    await expect(
      env.DB.prepare(
        `INSERT INTO evaluation_round_scores (event_id, id, assignment_id, criterion_id,
           value_number, value_text, created_at, updated_at)
         VALUES (?, 'duplicate-score', ?, ?, 5, NULL, ?, ?)`,
      )
        .bind(EVENT, ASSIGNMENT, CRITERION, NOW, NOW)
        .run(),
    ).rejects.toThrow(/UNIQUE/i)

    // Exactly one of the two value columns carries the answer.
    await expect(
      env.DB.prepare(
        `INSERT INTO evaluation_round_scores (event_id, id, assignment_id, criterion_id,
           value_number, value_text, created_at, updated_at)
         VALUES (?, 'both-values', ?, ?, 5, 'prose', ?, ?)`,
      )
        .bind(EVENT, ASSIGNMENT, CRITERION, NOW, NOW)
        .run(),
    ).rejects.toThrow()

    // The assignment FK still refuses an answer with no assignment behind it.
    await expect(
      env.DB.prepare(
        `INSERT INTO evaluation_round_scores (event_id, id, assignment_id, criterion_id,
           value_number, value_text, created_at, updated_at)
         VALUES (?, 'orphan-score', 'no-such-assignment', ?, 3, NULL, ?, ?)`,
      )
        .bind(EVENT, CRITERION, NOW, NOW)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })
})
