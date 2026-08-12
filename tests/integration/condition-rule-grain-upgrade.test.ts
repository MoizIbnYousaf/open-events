import { describe, expect, it } from 'vitest'
import { applyD1Migrations, env, reset } from 'cloudflare:test'

import { migrationsUpTo } from './m2b-helpers'

/**
 * Migration 0015 as an UPGRADE, not a fresh build.
 *
 * A rebuild that only works on an empty database is not a migration. Every
 * deployment that already ran 0001–0014 holds condition-rule rows written under
 * the old uniqueness grain, and 0015 drops and recreates the table underneath
 * them: rows have to survive column-for-column, and the four triggers the dropped
 * table carried have to come back, or the upgrade silently trades a UNIQUE defect
 * for a lost immutability guard.
 *
 * The fresh-baseline path is covered by every other seeded suite. This one starts
 * from the schema as it stood BEFORE 0015, populates it the way the old grain
 * allowed, and then steps forward.
 */
const EVENT = 'aaaaaaaa-0000-4000-8000-00000000aaaa'
const FORM = 'bbbbbbbb-0000-4000-8000-00000000bbbb'
const VERSION = 'cccccccc-0000-4000-8000-00000000cccc'
const PAGE = 'dddddddd-0000-4000-8000-00000000dddd'
const ELEMENT_A = 'eeeeeeee-0000-4000-8000-00000000eeea'
const ELEMENT_B = 'eeeeeeee-0000-4000-8000-00000000eeeb'

/**
 * A draft version, deliberately: the immutability triggers refuse writes against
 * a PUBLISHED version, and this fixture has to be writable under the old grain
 * before the upgrade runs.
 */
async function populatePre0015(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at,
       website_url, organizer_contact, venue, event_type)
     VALUES (?, 'grain-upgrade-event', 'Grain Upgrade', 'UTC', 'draft',
       '2026-05-13T08:00:00.000Z', '2026-05-15T17:00:00.000Z',
       'https://example.test/grain', 'programme@example.test', 'Venue', 'conference')`,
  )
    .bind(EVENT)
    .run()
  await env.DB.prepare(
    `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
       opens_at, closes_at, total_cap, per_identity_limit)
     VALUES (?, ?, 'cfp', 'draft', NULL, NULL, NULL, NULL, NULL)`,
  )
    .bind(EVENT, FORM)
    .run()
  await env.DB.prepare(
    `INSERT INTO cfp_form_versions (event_id, id, form_id, version, status,
       content_hash, published_at, updated_at)
     VALUES (?, ?, ?, 1, 'draft', NULL, NULL, '2026-01-01T09:00:00.000Z')`,
  )
    .bind(EVENT, VERSION, FORM)
    .run()
  await env.DB.prepare(
    `INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
     VALUES (?, ?, ?, 0, 'info', 'Proposal', '')`,
  )
    .bind(EVENT, PAGE, VERSION)
    .run()
  for (const [id, fieldKey, position] of [
    [ELEMENT_A, 'format', 0],
    [ELEMENT_B, 'workshop_details', 1],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO cfp_elements (event_id, id, version_id, page_id, position, kind,
         field_key, label, required, max_length, question_type, options_json)
       VALUES (?, ?, ?, ?, ?, 'question', ?, 'Label', 0, NULL, 'short_text', NULL)`,
    )
      .bind(EVENT, id, VERSION, PAGE, position, fieldKey)
      .run()
  }
  // Two rows the OLD grain accepted: distinct elements, so distinct
  // (version, element, group, condition) coordinates.
  for (const [id, ruleId, elementId, effect] of [
    ['11111111-0000-4000-8000-000000000001', 'legacy-rule-1', ELEMENT_B, 'show'],
    ['11111111-0000-4000-8000-000000000002', 'legacy-rule-2', ELEMENT_A, 'require'],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
         group_index, condition_index, operator, operand_key, value_json, effect, position)
       VALUES (?, ?, ?, ?, ?, 0, 0, 'eq', 'format', '"Workshop"', ?, 0)`,
    )
      .bind(EVENT, id, ruleId, VERSION, elementId, effect)
      .run()
  }
}

describe('migration 0015 upgrades a populated pre-0015 database', () => {
  it('preserves every existing row and restores the old grain’s guards', async () => {
    await reset()
    await applyD1Migrations(env.DB, migrationsUpTo('0014_widen_uploaded_file_kinds.sql'))
    await populatePre0015()

    // The old grain is genuinely in force before the upgrade: a second rule on
    // ELEMENT_B at the same coordinates is rejected.
    await expect(
      env.DB.prepare(
        `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
           group_index, condition_index, operator, operand_key, value_json, effect, position)
         VALUES (?, '22222222-0000-4000-8000-000000000001', 'legacy-rule-3', ?, ?, 0, 0,
                 'eq', 'format', '"Workshop"', 'require', 1)`,
      )
        .bind(EVENT, VERSION, ELEMENT_B)
        .run(),
    ).rejects.toThrow(/UNIQUE/i)

    const before = await env.DB.prepare(
      `SELECT id, rule_id, element_id, effect, operand_key, value_json, position
         FROM cfp_condition_rules WHERE version_id = ? ORDER BY id`,
    )
      .bind(VERSION)
      .all<Record<string, unknown>>()
    expect(before.results).toHaveLength(2)

    // Step forward.
    await applyD1Migrations(env.DB, migrationsUpTo('0015_fix_condition_rule_unique_grain.sql'))

    const after = await env.DB.prepare(
      `SELECT id, rule_id, element_id, effect, operand_key, value_json, position
         FROM cfp_condition_rules WHERE version_id = ? ORDER BY id`,
    )
      .bind(VERSION)
      .all<Record<string, unknown>>()
    // Column-for-column, not merely the same count.
    expect(after.results).toEqual(before.results)

    // The pair the old grain refused now persists.
    await env.DB.prepare(
      `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
         group_index, condition_index, operator, operand_key, value_json, effect, position)
       VALUES (?, '33333333-0000-4000-8000-000000000001', 'new-require', ?, ?, 0, 0,
               'eq', 'format', '"Workshop"', 'require', 1)`,
    )
      .bind(EVENT, VERSION, ELEMENT_B)
      .run()
    const paired = await env.DB.prepare(
      `SELECT effect FROM cfp_condition_rules WHERE element_id = ? ORDER BY effect`,
    )
      .bind(ELEMENT_B)
      .all<{ effect: string }>()
    expect(paired.results.map((row) => row.effect)).toEqual(['require', 'show'])

    // A duplicate WITHIN one rule is still a duplicate.
    await expect(
      env.DB.prepare(
        `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
           group_index, condition_index, operator, operand_key, value_json, effect, position)
         VALUES (?, '44444444-0000-4000-8000-000000000001', 'new-require', ?, ?, 0, 0,
                 'eq', 'format', '"Workshop"', 'require', 1)`,
      )
        .bind(EVENT, VERSION, ELEMENT_B)
        .run(),
    ).rejects.toThrow(/UNIQUE/i)

    // The same-version trigger survived the rebuild.
    await expect(
      env.DB.prepare(
        `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
           group_index, condition_index, operator, operand_key, value_json, effect, position)
         VALUES (?, '55555555-0000-4000-8000-000000000001', 'cross-version',
                 'ffffffff-0000-4000-8000-00000000ffff', ?, 0, 0,
                 'eq', 'format', '"Workshop"', 'show', 0)`,
      )
        .bind(EVENT, ELEMENT_B)
        .run(),
    ).rejects.toThrow()

    // And the publish-immutability guards: publishing the version must freeze the
    // rules underneath it, which is only true if both triggers came back.
    await env.DB.prepare(
      `UPDATE cfp_form_versions SET status = 'published',
         content_hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
         published_at = '2026-01-02T09:00:00.000Z' WHERE event_id = ? AND id = ?`,
    )
      .bind(EVENT, VERSION)
      .run()
    await expect(
      env.DB.prepare(`UPDATE cfp_condition_rules SET position = 7 WHERE version_id = ?`)
        .bind(VERSION)
        .run(),
    ).rejects.toThrow(/immutable/i)
    await expect(
      env.DB.prepare(`DELETE FROM cfp_condition_rules WHERE version_id = ?`).bind(VERSION).run(),
    ).rejects.toThrow(/immutable/i)
  })
})
