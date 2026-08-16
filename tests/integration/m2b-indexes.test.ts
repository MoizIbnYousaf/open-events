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
})

async function planFor(sql: string, ...binds: string[]): Promise<string> {
  const rows = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...binds)
    .all<{ detail: string }>()
  return rows.results.map((row) => row.detail).join(' | ')
}
