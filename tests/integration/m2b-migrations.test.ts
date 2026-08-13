import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import {
  DEMO_CONF_2026_CONTENT_HASH,
  DEMO_CONF_2026_FORM_ID,
  DEMO_CONF_2026_ID,
  DEMO_CONF_2026_PUBLISHED_AT,
  DEMO_CONF_2026_VERSION_ID,
} from '../../src/db'
import { SEEDED_CONTACTS, applyMigrations, countRows, seedDemoConf } from './m2b-helpers'

const EXPECTED_TABLES = [
  'events',
  'contacts',
  'submitter_tokens',
  'sessions',
  'taxonomy_items',
  'cfp_forms',
  'cfp_form_versions',
  'cfp_pages',
  'cfp_elements',
  'cfp_condition_rules',
  'cfp_routing_rules',
  'proposal_drafts',
  'proposal_submissions',
  'submission_contributors',
  'captured_messages',
  'confirmation_records',
  'agenda_sessions',
  'agenda_session_speakers',
  'submission_acceptances',
  'submission_decisions',
  'speaker_tasks',
  'uploaded_files',
  'evaluation_criteria',
  'evaluation_rounds',
  'evaluation_assignments',
  'evaluation_scores',
] as const

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
})

describe('migration apply from an empty local D1', () => {
  it('applies the baseline migrations idempotently and creates every M2 table', async () => {
    await applyMigrations(env.DB)

    const migrations = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{
      name: string
    }>()
    // Every committed migration, in order and with no gaps: the baseline is
    // the schema a deployment actually reaches.
    expect(migrations.results.map((row) => row.name)).toEqual([
      '0001_create_events_table.sql',
      '0002_create_m2_tables.sql',
      '0003_add_m2b_lookup_indexes_integrity.sql',
      '0004_global_unique_entity_ids.sql',
      '0005_add_submitter_token_form.sql',
      '0006_create_agenda_tables.sql',
      '0007_create_speaker_task_tables.sql',
      '0008_create_uploaded_files_table.sql',
      '0009_add_captured_message_submission.sql',
      '0010_create_evaluation_tables.sql',
      '0011_add_form_tasks.sql',
      '0012_add_message_kinds.sql',
      '0013_add_contact_bio.sql',
      '0014_widen_uploaded_file_kinds.sql',
      '0015_fix_condition_rule_unique_grain.sql',
      '0016_create_submission_decisions.sql',
      '0017_configurable_review_rounds.sql',
      '0018_cascade_round_scores_to_criteria.sql',
      '0019_add_assignment_recusal.sql',
      '0020_add_element_options_source.sql',
    ])

    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>()
    const names = tables.results.map((row) => row.name)
    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table)
    }
  })

  it('produces a deterministic seeded row set and is idempotent on re-seed', async () => {
    await seedDemoConf(env.DB)
    await seedDemoConf(env.DB)

    const event = await env.DB.prepare('SELECT * FROM events WHERE slug = ?')
      .bind('demo-conf-2026')
      .first()
    expect(event).toEqual({
      id: DEMO_CONF_2026_ID,
      slug: 'demo-conf-2026',
      name: 'DemoConf 2026',
      timezone: 'Europe/Berlin',
      status: 'draft',
      starts_at: '2026-05-13T08:00:00.000Z',
      ends_at: '2026-05-15T17:00:00.000Z',
      website_url: 'https://example.test/demo-conf-2026',
      organizer_contact: 'programme@example.test',
      venue: 'DemoConf Convention Center, Berlin',
      event_type: 'conference',
    })
    expect(await countRows(env.DB, 'events')).toBe(1)
    expect(await countRows(env.DB, 'cfp_forms')).toBe(1)
    expect(await countRows(env.DB, 'cfp_form_versions')).toBe(1)
    expect(await countRows(env.DB, 'cfp_pages')).toBe(4)
    // Nine questions across the proposal and participant steps, and the
    // conditional one carries BOTH a show and a require rule (two rows).
    expect(await countRows(env.DB, 'cfp_elements')).toBe(9)
    expect(await countRows(env.DB, 'cfp_condition_rules')).toBe(2)
    expect(await countRows(env.DB, 'cfp_routing_rules')).toBe(1)
    // Three formats, three tracks, two rooms.
    expect(await countRows(env.DB, 'taxonomy_items')).toBe(8)
    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS)
    expect(await countRows(env.DB, 'evaluation_criteria')).toBe(1)
    expect(await countRows(env.DB, 'evaluation_rounds')).toBe(1)
    expect(await countRows(env.DB, 'evaluation_assignments')).toBe(0)
    expect(await countRows(env.DB, 'evaluation_scores')).toBe(0)

    const form = await env.DB.prepare(
      'SELECT status, published_version_id FROM cfp_forms WHERE id = ?',
    )
      .bind(DEMO_CONF_2026_FORM_ID)
      .first()
    expect(form).toEqual({
      status: 'published',
      published_version_id: DEMO_CONF_2026_VERSION_ID,
    })
    const version = await env.DB.prepare(
      'SELECT content_hash, published_at, updated_at FROM cfp_form_versions WHERE id = ?',
    )
      .bind(DEMO_CONF_2026_VERSION_ID)
      .first()
    expect(version).toEqual({
      content_hash: DEMO_CONF_2026_CONTENT_HASH,
      published_at: DEMO_CONF_2026_PUBLISHED_AT,
      updated_at: DEMO_CONF_2026_PUBLISHED_AT,
    })
  })

  it('reproduces identical schema and seed after a fresh reset (db:reset determinism)', async () => {
    await seedDemoConf(env.DB)
    const firstTables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>()
    const firstEvent = await env.DB.prepare('SELECT * FROM events').first()
    const firstCounts = {
      forms: await countRows(env.DB, 'cfp_forms'),
      pages: await countRows(env.DB, 'cfp_pages'),
    }

    await reset()
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)

    const secondTables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>()
    const secondEvent = await env.DB.prepare('SELECT * FROM events').first()
    expect(secondTables.results).toEqual(firstTables.results)
    expect(secondEvent).toEqual(firstEvent)
    expect(await countRows(env.DB, 'cfp_forms')).toBe(firstCounts.forms)
    expect(await countRows(env.DB, 'cfp_pages')).toBe(firstCounts.pages)
  })
})
