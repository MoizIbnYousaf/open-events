import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { createSubmitUnitOfWork } from '../../src/db'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { NOW } from '../unit/helpers/fixtures'
import { applyMigrations, buildSubmitBatch, countRows, seedDemoConf } from './m2b-helpers'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
  await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind('contact-speaker-a', 'speaker-a@example.test', 'Speaker A', NOW)
    .run()
})

async function insertPublishedForm(
  formId: string,
  versionId: string,
  caps: {
    readonly totalCap: number | null
    readonly perIdentityLimit: number | null
  },
) {
  await env.DB.prepare(
    `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                              opens_at, closes_at, total_cap, per_identity_limit)
       VALUES (?, ?, ?, 'published', ?, NULL, NULL, ?, ?)`,
  )
    .bind(
      DEMO_CONF_2026_ID,
      formId,
      `form-${formId}`,
      versionId,
      caps.totalCap,
      caps.perIdentityLimit,
    )
    .run()
  await env.DB.prepare(
    `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                      content_hash, published_at, updated_at)
       VALUES (?, ?, ?, 1, 'published', ?, ?, ?)`,
  )
    .bind(DEMO_CONF_2026_ID, formId, versionId, 'a'.repeat(64), NOW, NOW)
    .run()
}

describe('version-bound submit gate against real D1', () => {
  it('accepts a submit against the currently published version', async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)

    const result = await unitOfWork.execute(buildSubmitBatch())

    expect(result.outcome).toBe('inserted')
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
  })

  it('returns closed with zero writes when the version binding drifts', async () => {
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES (?, ?, 'version-2', 2, 'draft', NULL, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_FORM_ID, NOW)
      .run()
    await env.DB.prepare(
      'UPDATE cfp_forms SET published_version_id = ? WHERE event_id = ? AND id = ?',
    )
      .bind('version-2', DEMO_CONF_2026_ID, DEMO_CONF_2026_FORM_ID)
      .run()
    const unitOfWork = createSubmitUnitOfWork(env.DB)

    const result = await unitOfWork.execute(
      buildSubmitBatch({ formVersionId: DEMO_CONF_2026_VERSION_ID }),
    )

    expect(result.outcome).toBe('closed')
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
    expect(await countRows(env.DB, 'contacts')).toBe(1)
  })

  it('returns closed for an unpublished form', async () => {
    await env.DB.prepare(
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                                opens_at, closes_at, total_cap, per_identity_limit)
         VALUES (?, 'form-unpublished', 'unpublished', 'draft', NULL, NULL, NULL, NULL, NULL)`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES (?, 'form-unpublished', 'version-unpublished', 1, 'draft', NULL, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, NOW)
      .run()
    const unitOfWork = createSubmitUnitOfWork(env.DB)

    const result = await unitOfWork.execute(
      buildSubmitBatch({ formId: 'form-unpublished', formVersionId: 'version-unpublished' }),
    )

    expect(result.outcome).toBe('closed')
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
  })

  it('enforces the per-identity limit from real rows', async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    await unitOfWork.execute(buildSubmitBatch({ originDraftId: 'draft-1', submissionId: 'sub-1' }))

    const result = await unitOfWork.execute(
      buildSubmitBatch({ originDraftId: 'draft-2', submissionId: 'sub-2' }),
    )

    expect(result.outcome).toBe('identity-limited')
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
  })

  it('enforces a positive total cap at equality', async () => {
    await insertPublishedForm('form-cap', 'version-cap', { totalCap: 1, perIdentityLimit: null })
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    await unitOfWork.execute(
      buildSubmitBatch({
        formId: 'form-cap',
        formVersionId: 'version-cap',
        originDraftId: 'draft-1',
        submissionId: 'sub-1',
      }),
    )

    const result = await unitOfWork.execute(
      buildSubmitBatch({
        formId: 'form-cap',
        formVersionId: 'version-cap',
        originDraftId: 'draft-2',
        submissionId: 'sub-2',
      }),
    )

    expect(result.outcome).toBe('capped')
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
  })

  it('treats NULL caps as unlimited', async () => {
    await insertPublishedForm('form-open', 'version-open', {
      totalCap: null,
      perIdentityLimit: null,
    })
    const unitOfWork = createSubmitUnitOfWork(env.DB)

    const first = await unitOfWork.execute(
      buildSubmitBatch({
        formId: 'form-open',
        formVersionId: 'version-open',
        originDraftId: 'draft-1',
        submissionId: 'sub-1',
      }),
    )
    const second = await unitOfWork.execute(
      buildSubmitBatch({
        formId: 'form-open',
        formVersionId: 'version-open',
        originDraftId: 'draft-2',
        submissionId: 'sub-2',
      }),
    )

    expect(first.outcome).toBe('inserted')
    expect(second.outcome).toBe('inserted')
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(2)
  })
})
