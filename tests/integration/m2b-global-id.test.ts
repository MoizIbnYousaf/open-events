import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { NOW } from '../unit/helpers/fixtures'
import { applyMigrations, expectRejects, seedDemoConf } from './m2b-helpers'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function insertEventB() {
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
       VALUES ('event-b', 'event-b', 'Event B', 'UTC', 'draft', NULL, NULL)`,
  ).run()
}

describe('globally unique entity ids (migration 0004)', () => {
  it('two events cannot insert the same cfp_forms.id', async () => {
    await insertEventB()

    await expectRejects(
      env.DB,
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                              opens_at, closes_at, total_cap, per_identity_limit)
       VALUES ('event-b', ?, 'cfp-b', 'draft', NULL, NULL, NULL, NULL, NULL)`,
      DEMO_CONF_2026_FORM_ID,
    )

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM cfp_forms WHERE id = ?')
      .bind(DEMO_CONF_2026_FORM_ID)
      .first<{ n: number }>()
    expect(count?.n).toBe(1)

    const distinct = await env.DB.prepare(
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                                opens_at, closes_at, total_cap, per_identity_limit)
         VALUES ('event-b', 'form-b', 'cfp-b', 'draft', NULL, NULL, NULL, NULL, NULL)`,
    ).run()
    expect(distinct.success).toBe(true)
  })

  it('two events cannot insert the same proposal_drafts.id', async () => {
    await insertEventB()
    await env.DB.prepare(
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                                opens_at, closes_at, total_cap, per_identity_limit)
         VALUES ('event-b', 'form-b', 'cfp-b', 'draft', NULL, NULL, NULL, NULL, NULL)`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES ('event-b', 'form-b', 'version-b', 1, 'draft', NULL, NULL, ?)`,
    )
      .bind(NOW)
      .run()
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-global', 'global@example.test', 'Global', NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO proposal_drafts (id, event_id, owner_contact_id, form_version_id,
                                      title, answers_json, created_at, updated_at)
         VALUES ('draft-global', ?, 'contact-global', ?, 't', '{}', ?, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID, NOW, NOW)
      .run()

    await expectRejects(
      env.DB,
      `INSERT INTO proposal_drafts (id, event_id, owner_contact_id, form_version_id,
                                    title, answers_json, created_at, updated_at)
       VALUES ('draft-global', 'event-b', 'contact-global', 'version-b', 't', '{}', ?, ?)`,
      NOW,
      NOW,
    )

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM proposal_drafts WHERE id = ?')
      .bind('draft-global')
      .first<{ n: number }>()
    expect(count?.n).toBe(1)
  })
})
