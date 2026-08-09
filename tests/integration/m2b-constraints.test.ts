import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { NOW } from '../unit/helpers/fixtures'
import { applyMigrations, countRows, expectRejects, seedDemoConf } from './m2b-helpers'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

describe('composite FK denial', () => {
  it('rejects a child row referencing a parent of another event', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
       VALUES ('event-other', 'page-cross', ?, 0, 'info', 't', 'c')`,
      DEMO_CONF_2026_VERSION_ID,
    )
  })

  it('rejects a duplicate (event_id, id) parent row', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO taxonomy_items (event_id, id, kind, key, label, position)
       VALUES (?, 'f0000000-0000-4000-8000-000000000501', 'format', 'dup', 'Dup', 9)`,
      DEMO_CONF_2026_ID,
    )
  })

  it('accepts a same-event child insert', async () => {
    const result = await env.DB.prepare(
      `INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
         VALUES (?, 'page-ok', ?, 9, 'info', 't', 'c')`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID)
      .run()

    expect(result.success).toBe(true)
  })
})

describe('CHECK and json backstops', () => {
  it('rejects an invalid form status and a bad published/draft state', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                              opens_at, closes_at, total_cap, per_identity_limit)
       VALUES (?, 'form-bad', 'bad', 'bogus', NULL, NULL, NULL, NULL, NULL)`,
      DEMO_CONF_2026_ID,
    )
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                              opens_at, closes_at, total_cap, per_identity_limit)
       VALUES (?, 'form-pub-no-ptr', 'pub', 'published', NULL, NULL, NULL, NULL, NULL)`,
      DEMO_CONF_2026_ID,
    )
  })

  it('rejects zero and negative caps and inverted date windows', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                              opens_at, closes_at, total_cap, per_identity_limit)
       VALUES (?, 'form-cap', 'cap', 'draft', NULL, NULL, NULL, 0, NULL)`,
      DEMO_CONF_2026_ID,
    )
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                              opens_at, closes_at, total_cap, per_identity_limit)
       VALUES (?, 'form-limit', 'limit', 'draft', NULL, NULL, NULL, NULL, -1)`,
      DEMO_CONF_2026_ID,
    )
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                              opens_at, closes_at, total_cap, per_identity_limit)
       VALUES (?, 'form-dates', 'dates', 'draft', NULL, '2026-06-01T00:00:00.000Z',
               '2026-05-01T00:00:00.000Z', NULL, NULL)`,
      DEMO_CONF_2026_ID,
    )
  })

  it('rejects partial event dates', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
       VALUES ('event-partial', 'partial', 'Partial', 'UTC', 'draft',
               '2026-01-01T00:00:00.000Z', NULL)`,
    )
  })

  it('rejects malformed answers_json and condition_json', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-owner', 'owner@example.test', 'Owner', NOW)
      .run()

    await expectRejects(
      env.DB,
      `INSERT INTO proposal_drafts (id, event_id, owner_contact_id, form_version_id,
                                    title, answers_json, created_at, updated_at)
       VALUES ('draft-bad-json', ?, 'contact-owner', ?, 't', 'not-json', ?, ?)`,
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
      NOW,
      NOW,
    )
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_routing_rules (event_id, id, version_id, position,
                                      condition_json, action_kind, action_target)
       VALUES (?, 'routing-bad-json', ?, 9, 'not-json', 'assign_track', 'x')`,
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
  })
})

describe('published-version immutability triggers', () => {
  it('rejects UPDATE and DELETE of the published version row', async () => {
    await expectRejects(
      env.DB,
      'UPDATE cfp_form_versions SET content_hash = ? WHERE event_id = ? AND id = ?',
      'b'.repeat(64),
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    await expectRejects(
      env.DB,
      'DELETE FROM cfp_form_versions WHERE event_id = ? AND id = ?',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
  })

  it('rejects UPDATE and DELETE of content rows under a published version', async () => {
    await expectRejects(
      env.DB,
      'UPDATE cfp_pages SET title = ? WHERE event_id = ? AND version_id = ?',
      'x',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    await expectRejects(
      env.DB,
      'DELETE FROM cfp_pages WHERE event_id = ? AND version_id = ?',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    await expectRejects(
      env.DB,
      'UPDATE cfp_elements SET label = ? WHERE event_id = ? AND version_id = ?',
      'x',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    await expectRejects(
      env.DB,
      'DELETE FROM cfp_elements WHERE event_id = ? AND version_id = ?',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    await expectRejects(
      env.DB,
      "UPDATE cfp_condition_rules SET effect = 'require' WHERE event_id = ? AND version_id = ?",
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    await expectRejects(
      env.DB,
      'DELETE FROM cfp_condition_rules WHERE event_id = ? AND version_id = ?',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    await expectRejects(
      env.DB,
      'UPDATE cfp_routing_rules SET action_target = ? WHERE event_id = ? AND version_id = ?',
      'talk',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    await expectRejects(
      env.DB,
      'DELETE FROM cfp_routing_rules WHERE event_id = ? AND version_id = ?',
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
  })

  it('keeps draft version rows and their content mutable', async () => {
    const versionId = 'version-draft'
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES (?, ?, ?, 2, 'draft', NULL, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_FORM_ID, versionId, NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
         VALUES (?, 'page-draft', ?, 0, 'info', 't', 'c')`,
    )
      .bind(DEMO_CONF_2026_ID, versionId)
      .run()

    const update = await env.DB.prepare(
      'UPDATE cfp_pages SET title = ? WHERE event_id = ? AND version_id = ?',
    )
      .bind('new-title', DEMO_CONF_2026_ID, versionId)
      .run()
    expect(update.meta.changes).toBe(1)

    const remove = await env.DB.prepare(
      'DELETE FROM cfp_pages WHERE event_id = ? AND version_id = ?',
    )
      .bind(DEMO_CONF_2026_ID, versionId)
      .run()
    expect(remove.meta.changes).toBe(1)
    expect(await countRows(env.DB, 'cfp_pages')).toBe(4)
  })
})

describe('cross-version membership triggers (migration 0003)', () => {
  const V1_PAGE = 'f0000000-0000-4000-8000-000000000101'
  const V1_ELEMENT = 'f0000000-0000-4000-8000-000000000201'

  beforeEach(async () => {
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES (?, ?, 'version-2', 2, 'draft', NULL, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_FORM_ID, NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
         VALUES (?, 'page-v2', 'version-2', 0, 'info', 't', 'c')`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()
  })

  it('rejects an element insert whose page belongs to another version', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_elements (event_id, id, version_id, page_id, position, kind,
                                 field_key, label, required, max_length, question_type, options_json)
       VALUES (?, 'el-cross', 'version-2', ?, 0, 'question', 'cross', 'Cross', 1, NULL,
               'short_text', NULL)`,
      DEMO_CONF_2026_ID,
      V1_PAGE,
    )
  })

  it('rejects an element update moving it across versions', async () => {
    await env.DB.prepare(
      `INSERT INTO cfp_elements (event_id, id, version_id, page_id, position, kind,
                                   field_key, label, required, max_length, question_type, options_json)
         VALUES (?, 'el-ok', 'version-2', 'page-v2', 0, 'question', 'ok', 'Ok', 1, NULL,
                 'short_text', NULL)`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()

    await expectRejects(
      env.DB,
      'UPDATE cfp_elements SET page_id = ? WHERE event_id = ? AND id = ?',
      V1_PAGE,
      DEMO_CONF_2026_ID,
      'el-ok',
    )
  })

  it('rejects a condition rule insert whose element belongs to another version', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
                                        group_index, condition_index, operator, operand_key,
                                        value_json, effect, position)
       VALUES (?, 'cr-cross', 'rule-cross', 'version-2', ?, 0, 0, 'eq', 'format',
               '"workshop"', 'show', 9)`,
      DEMO_CONF_2026_ID,
      V1_ELEMENT,
    )
  })

  it('rejects a condition rule update moving it across versions', async () => {
    await env.DB.prepare(
      `INSERT INTO cfp_elements (event_id, id, version_id, page_id, position, kind,
                                   field_key, label, required, max_length, question_type, options_json)
         VALUES (?, 'el-ok', 'version-2', 'page-v2', 0, 'question', 'ok', 'Ok', 1, NULL,
                 'short_text', NULL)`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_condition_rules (event_id, id, rule_id, version_id, element_id,
                                          group_index, condition_index, operator, operand_key,
                                          value_json, effect, position)
         VALUES (?, 'cr-ok', 'rule-ok', 'version-2', 'el-ok', 0, 0, 'eq', 'format',
                 '"workshop"', 'show', 9)`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()

    await expectRejects(
      env.DB,
      'UPDATE cfp_condition_rules SET element_id = ? WHERE event_id = ? AND id = ?',
      V1_ELEMENT,
      DEMO_CONF_2026_ID,
      'cr-ok',
    )
  })
})
