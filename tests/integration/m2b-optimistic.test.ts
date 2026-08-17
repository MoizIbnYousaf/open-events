import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { createDraftRepository, createFormBuilderUnitOfWork } from '../../src/db'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import type { CfpForm, FormVersion } from '../../src/domain'
import { NOW, createContent, createDraft } from '../unit/helpers/fixtures'
import { applyMigrations, countRows, seedDemoConf } from './m2b-helpers'

const T1 = '2026-01-01T09:00:00.000Z'
const T2 = '2026-02-01T09:00:00.000Z'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

describe('optimistic draft save', () => {
  it('returns false and preserves the newer row when the stamp is stale', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-speaker-a', 'speaker-a@example.test', 'Speaker A', NOW)
      .run()
    const draft = createDraft({
      eventId: DEMO_CONF_2026_ID,
      formVersionId: DEMO_CONF_2026_VERSION_ID,
      updatedAt: T1,
    })
    await env.DB.prepare(
      `INSERT INTO proposal_drafts (id, event_id, owner_contact_id, form_version_id,
                                      title, answers_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'original', '{}', ?, ?)`,
    )
      .bind(draft.id, draft.eventId, draft.ownerContactId, draft.formVersionId, T1, T1)
      .run()
    await env.DB.prepare('UPDATE proposal_drafts SET title = ?, updated_at = ? WHERE id = ?')
      .bind('concurrent-writer', T2, draft.id)
      .run()

    const saved = await createDraftRepository(env.DB).save(
      { ...draft, title: 'stale', updatedAt: T1 },
      T1,
    )

    expect(saved).toBe(false)
    const row = await env.DB.prepare('SELECT title, updated_at FROM proposal_drafts WHERE id = ?')
      .bind(draft.id)
      .first()
    expect(row).toEqual({ title: 'concurrent-writer', updated_at: T2 })
  })
})

describe('optimistic form-builder saveDraft', () => {
  it('returns conflict with zero writes when the expected stamp is stale', async () => {
    const versionId = 'version-draft'
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES (?, ?, ?, 2, 'draft', NULL, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_FORM_ID, versionId, T1)
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
         VALUES (?, 'page-draft', ?, 0, 'info', 'original', 'c')`,
    )
      .bind(DEMO_CONF_2026_ID, versionId)
      .run()
    await env.DB.prepare('UPDATE cfp_form_versions SET updated_at = ? WHERE id = ?')
      .bind(T2, versionId)
      .run()

    const unitOfWork = createFormBuilderUnitOfWork(env.DB)
    const expected: FormVersion = {
      id: versionId,
      eventId: DEMO_CONF_2026_ID,
      formId: DEMO_CONF_2026_FORM_ID,
      version: 2,
      status: 'draft',
      contentHash: null,
      publishedAt: null,
      updatedAt: T1,
    }
    const content = createContent()
    const result = await unitOfWork.saveDraft({ expected, version: expected, content })

    expect(result).toEqual({ outcome: 'conflict' })
    const row = await env.DB.prepare(
      'SELECT status, updated_at FROM cfp_form_versions WHERE id = ?',
    )
      .bind(versionId)
      .first()
    expect(row).toEqual({ status: 'draft', updated_at: T2 })
    expect(await countRows(env.DB, 'cfp_pages')).toBe(5)
    const page = await env.DB.prepare("SELECT title FROM cfp_pages WHERE id = 'page-draft'").first()
    expect(page?.title).toBe('original')
  })
})

describe('optimistic publish', () => {
  it('returns conflict and leaves the version and pointer untouched when stale', async () => {
    const formId = 'form-draft'
    const versionId = 'version-draft'
    await env.DB.prepare(
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                                opens_at, closes_at, total_cap, per_identity_limit)
         VALUES (?, ?, 'cfp-draft', 'draft', NULL, NULL, NULL, NULL, NULL)`,
    )
      .bind(DEMO_CONF_2026_ID, formId)
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES (?, ?, ?, 1, 'draft', NULL, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, formId, versionId, T1)
      .run()
    await env.DB.prepare('UPDATE cfp_form_versions SET updated_at = ? WHERE id = ?')
      .bind(T2, versionId)
      .run()

    const form: CfpForm = {
      id: formId,
      eventId: DEMO_CONF_2026_ID,
      slug: 'cfp-draft',
      status: 'draft',
      purpose: 'public',
      publishedVersionId: null,
      limits: { opensAt: null, closesAt: null, totalCap: null, perIdentityLimit: null },
    }
    const expected: FormVersion = {
      id: versionId,
      eventId: DEMO_CONF_2026_ID,
      formId,
      version: 1,
      status: 'draft',
      contentHash: null,
      publishedAt: null,
      updatedAt: T1,
    }
    const unitOfWork = createFormBuilderUnitOfWork(env.DB)

    const result = await unitOfWork.publish({
      expected,
      publishedVersion: {
        ...expected,
        status: 'published',
        contentHash: 'a'.repeat(64),
        publishedAt: NOW,
        updatedAt: NOW,
      },
      expectedForm: form,
      form: { ...form, status: 'published', publishedVersionId: versionId },
    })

    expect(result).toEqual({ outcome: 'conflict' })
    const storedForm = await env.DB.prepare(
      'SELECT status, published_version_id FROM cfp_forms WHERE id = ?',
    )
      .bind(formId)
      .first()
    expect(storedForm).toEqual({ status: 'draft', published_version_id: null })
    const storedVersion = await env.DB.prepare(
      'SELECT status, updated_at FROM cfp_form_versions WHERE id = ?',
    )
      .bind(versionId)
      .first()
    expect(storedVersion).toEqual({ status: 'draft', updated_at: T2 })
  })

  it('publishes exactly once with fresh stamps', async () => {
    const formId = 'form-fresh'
    const versionId = 'version-fresh'
    await env.DB.prepare(
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                                opens_at, closes_at, total_cap, per_identity_limit)
         VALUES (?, ?, 'cfp-fresh', 'draft', NULL, NULL, NULL, NULL, NULL)`,
    )
      .bind(DEMO_CONF_2026_ID, formId)
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES (?, ?, ?, 1, 'draft', NULL, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, formId, versionId, T1)
      .run()

    const form: CfpForm = {
      id: formId,
      eventId: DEMO_CONF_2026_ID,
      slug: 'cfp-fresh',
      status: 'draft',
      purpose: 'public',
      publishedVersionId: null,
      limits: { opensAt: null, closesAt: null, totalCap: null, perIdentityLimit: null },
    }
    const expected: FormVersion = {
      id: versionId,
      eventId: DEMO_CONF_2026_ID,
      formId,
      version: 1,
      status: 'draft',
      contentHash: null,
      publishedAt: null,
      updatedAt: T1,
    }
    const unitOfWork = createFormBuilderUnitOfWork(env.DB)

    const result = await unitOfWork.publish({
      expected,
      publishedVersion: {
        ...expected,
        status: 'published',
        contentHash: 'a'.repeat(64),
        publishedAt: NOW,
        updatedAt: NOW,
      },
      expectedForm: form,
      form: { ...form, status: 'published', publishedVersionId: versionId },
    })

    expect(result).toEqual({ outcome: 'published' })
    const storedForm = await env.DB.prepare(
      'SELECT status, published_version_id FROM cfp_forms WHERE id = ?',
    )
      .bind(formId)
      .first()
    expect(storedForm).toEqual({ status: 'published', published_version_id: versionId })
  })
})
