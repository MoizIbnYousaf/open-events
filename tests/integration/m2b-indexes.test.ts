import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_FORM_ID } from '../../src/db'
import { applyMigrations, seedDemoConf } from './m2b-helpers'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

const EXPECTED_INDEXES = [
  'idx_submitter_tokens_event_contact',
  'idx_drafts_event_owner',
  'idx_submissions_event_version_owner',
  'idx_contributors_event_submission',
  'idx_captured_messages_email',
  'idx_cfp_form_versions_form_version',
  'idx_cfp_form_versions_id',
  'idx_proposal_submissions_id',
  'idx_proposal_drafts_id',
  'idx_cfp_forms_id',
  'idx_cfp_pages_event_version',
  'idx_cfp_elements_event_version',
  'idx_cfp_condition_rules_event_version',
  'idx_cfp_routing_rules_event_version',
  'submission_saved_views_event_name',
  'idx_proposal_submissions_event_submitted',
  'idx_evaluation_assignments_event_created',
  'idx_evaluation_assignments_event_recused',
  'idx_evaluation_scores_event_updated',
  'idx_evaluation_round_scores_event_updated',
  'idx_submission_decisions_event_decided',
  'idx_speaker_tasks_event_created',
  'idx_speaker_tasks_event_completed',
  'idx_captured_messages_event_created',
  'idx_agenda_sessions_event_updated',
] as const

describe('lookup indexes (migration 0003)', () => {
  it('creates every evidence-backed lookup index', async () => {
    const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all<{
      name: string
    }>()
    const names = rows.results.map((row) => row.name)

    for (const index of EXPECTED_INDEXES) {
      expect(names).toContain(index)
    }
  })

  it('recreates the ID-only lookup indexes as UNIQUE (migration 0004)', async () => {
    for (const name of ['idx_cfp_forms_id', 'idx_proposal_drafts_id']) {
      const row = await env.DB.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
      )
        .bind(name)
        .first<{ sql: string }>()
      expect(row?.sql).toMatch(/^CREATE UNIQUE INDEX/)
    }
  })

  it('uses the indexes with SEARCH and no full SCAN on the hot lookups', async () => {
    const plans = await Promise.all([
      planFor(
        `SELECT * FROM cfp_form_versions WHERE form_id = ? AND version = 1`,
        DEMO_CONF_2026_FORM_ID,
      ),
      planFor(`SELECT * FROM cfp_form_versions WHERE id = ?`, 'version-1'),
      planFor(
        `SELECT * FROM cfp_form_versions WHERE form_id = ? AND status = 'draft'
         ORDER BY version DESC LIMIT 1`,
        DEMO_CONF_2026_FORM_ID,
      ),
      planFor(
        `SELECT * FROM cfp_form_versions WHERE form_id = ? ORDER BY version`,
        DEMO_CONF_2026_FORM_ID,
      ),
      planFor(`SELECT * FROM proposal_submissions WHERE id = ?`, 'submission-1'),
      planFor(
        `SELECT * FROM submission_saved_views
          WHERE event_id = ? ORDER BY name COLLATE NOCASE, id`,
        'event-1',
      ),
    ])

    expect(plans[0]).toContain('USING INDEX idx_cfp_form_versions_form_version')
    expect(plans[1]).toContain('USING INDEX idx_cfp_form_versions_id')
    expect(plans[2]).toContain('USING INDEX idx_cfp_form_versions_form_version')
    expect(plans[2]).not.toContain('SCAN')
    expect(plans[2]).not.toContain('TEMP B-TREE')
    expect(plans[3]).toContain('USING INDEX idx_cfp_form_versions_form_version')
    expect(plans[3]).not.toContain('SCAN')
    expect(plans[3]).not.toContain('TEMP B-TREE')
    expect(plans[4]).toContain('USING INDEX idx_proposal_submissions_id')
    expect(plans[4]).not.toContain('SCAN')
    expect(plans[5]).toContain('USING INDEX submission_saved_views_event_name')
    expect(plans[5]).not.toContain('TEMP B-TREE')
  })

  it('uses the unique ID indexes with SEARCH on the ID-only lookups', async () => {
    const formsPlan = await planFor(
      `SELECT * FROM cfp_forms WHERE id = ?`,
      'f0000000-0000-4000-8000-000000000001',
    )
    const draftsPlan = await planFor(`SELECT * FROM proposal_drafts WHERE id = ?`, 'draft-x')

    expect(formsPlan).toContain('USING INDEX idx_cfp_forms_id')
    expect(formsPlan).not.toContain('SCAN')
    expect(draftsPlan).toContain('USING INDEX idx_proposal_drafts_id')
    expect(draftsPlan).not.toContain('SCAN')
  })

  it('uses the bounded timeline indexes without temporary ordering trees', async () => {
    const cases = [
      {
        index: 'idx_proposal_submissions_event_submitted',
        sql: `SELECT id FROM proposal_submissions
              WHERE event_id = ? ORDER BY submitted_at DESC, id LIMIT 101`,
      },
      {
        index: 'idx_evaluation_assignments_event_created',
        sql: `SELECT id FROM evaluation_assignments
              WHERE event_id = ? ORDER BY created_at DESC, id LIMIT 101`,
      },
      {
        index: 'idx_evaluation_assignments_event_recused',
        sql: `SELECT id FROM evaluation_assignments
              WHERE event_id = ? AND recused_at IS NOT NULL
              ORDER BY recused_at DESC, id LIMIT 101`,
      },
      {
        index: 'idx_submission_decisions_event_decided',
        sql: `SELECT id FROM submission_decisions
              WHERE event_id = ? ORDER BY decided_at DESC, id LIMIT 101`,
      },
      {
        index: 'idx_speaker_tasks_event_completed',
        sql: `SELECT id FROM speaker_tasks
              WHERE event_id = ? AND completed_at IS NOT NULL
              ORDER BY completed_at DESC, id LIMIT 101`,
      },
      {
        index: 'idx_captured_messages_event_created',
        sql: `SELECT id FROM captured_messages
              WHERE event_id = ? ORDER BY created_at DESC, id LIMIT 101`,
      },
      {
        index: 'idx_agenda_sessions_event_updated',
        sql: `SELECT submission_id FROM agenda_sessions
              WHERE event_id = ? AND assignment = 'scheduled'
              ORDER BY updated_at DESC, submission_id LIMIT 101`,
      },
    ] as const

    for (const entry of cases) {
      const plan = await planFor(entry.sql, 'event-1')
      expect(plan).toContain(entry.index)
      expect(plan).not.toContain('TEMP B-TREE')
    }
  })
})

async function planFor(sql: string, ...binds: string[]): Promise<string> {
  const rows = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...binds)
    .all<{ detail: string }>()
  return rows.results.map((row) => row.detail).join(' | ')
}
