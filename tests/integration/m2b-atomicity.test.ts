import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import {
  createFormBuilderUnitOfWork,
  createSessionUnitOfWork,
  createSubmitUnitOfWork,
} from '../../src/db'
import { DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import type { CfpForm, FormVersion } from '../../src/domain'
import { NOW } from '../unit/helpers/fixtures'
import { applyMigrations, buildSubmitBatch, countRows, seedDemoConf } from './m2b-helpers'

const FUTURE = '2026-12-31T23:59:59.000Z'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function seedOwnerAndDraft() {
  await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind('contact-speaker-a', 'speaker-a@example.test', 'Speaker A', NOW)
    .run()
  await env.DB.prepare(
    `INSERT INTO proposal_drafts (id, event_id, owner_contact_id, form_version_id,
                                    title, answers_json, created_at, updated_at)
       VALUES ('draft-origin-1', ?, 'contact-speaker-a', ?, 'Draft', '{}', ?, ?)`,
  )
    .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID, NOW, NOW)
    .run()
}

describe('submit unit-of-work atomic rollback', () => {
  it('leaves zero partial rows when a batch statement fails', async () => {
    await seedOwnerAndDraft()
    const unitOfWork = createSubmitUnitOfWork(env.DB)

    await expect(
      unitOfWork.execute(
        buildSubmitBatch({
          coSpeakers: [{ name: 'Co', email: 'co@example.test' }],
          messageCreatedAt: 'bad-instant',
        }),
      ),
    ).rejects.toThrow()

    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
    expect(await countRows(env.DB, 'submission_contributors')).toBe(0)
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(0)
    expect(await countRows(env.DB, 'contacts')).toBe(1)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(1)
  })
})

describe('publish unit-of-work atomic rollback', () => {
  it('leaves the version draft and the form pointer unchanged on failure', async () => {
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
      .bind(DEMO_CONF_2026_ID, formId, versionId, NOW)
      .run()

    const form: CfpForm = {
      id: formId,
      eventId: DEMO_CONF_2026_ID,
      slug: 'cfp-draft',
      status: 'draft',
      publishedVersionId: null,
      limits: { opensAt: null, closesAt: null, totalCap: null, perIdentityLimit: null },
    }
    const version: FormVersion = {
      id: versionId,
      eventId: DEMO_CONF_2026_ID,
      formId,
      version: 1,
      status: 'draft',
      contentHash: null,
      publishedAt: null,
      updatedAt: NOW,
    }
    const unitOfWork = createFormBuilderUnitOfWork(env.DB)

    await expect(
      unitOfWork.publish({
        expected: version,
        publishedVersion: {
          ...version,
          status: 'published',
          contentHash: 'a'.repeat(64),
          publishedAt: 'bad-instant',
          updatedAt: 'bad-instant',
        },
        expectedForm: form,
        form: { ...form, status: 'published', publishedVersionId: versionId },
      }),
    ).rejects.toThrow()

    const storedForm = await env.DB.prepare(
      'SELECT status, published_version_id FROM cfp_forms WHERE id = ?',
    )
      .bind(formId)
      .first()
    expect(storedForm).toEqual({ status: 'draft', published_version_id: null })
    const storedVersion = await env.DB.prepare(
      'SELECT status, content_hash, published_at FROM cfp_form_versions WHERE id = ?',
    )
      .bind(versionId)
      .first()
    expect(storedVersion).toEqual({
      status: 'draft',
      content_hash: null,
      published_at: null,
    })
  })
})

describe('session redeem unit-of-work atomic rollback', () => {
  it('keeps the token unconsumed and writes no session row on failure', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-speaker-a', 'speaker-a@example.test', 'Speaker A', NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO submitter_tokens (id, event_id, contact_id, token_hash,
                                       expires_at, consumed_at, created_at)
         VALUES ('token-1', ?, 'contact-speaker-a', ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, 'a'.repeat(64), FUTURE, NOW)
      .run()
    const unitOfWork = createSessionUnitOfWork(env.DB)

    await expect(
      unitOfWork.redeemSubmitterToken({
        tokenId: 'token-1',
        consumedAt: NOW,
        session: {
          id: 'session-1',
          kind: 'submitter',
          contactId: 'contact-speaker-a',
          eventId: DEMO_CONF_2026_ID,
          tokenHash: 'b'.repeat(64),
          expiresAt: 'bad-instant',
          consumedAt: null,
          createdAt: NOW,
        },
      }),
    ).rejects.toThrow()

    const token = await env.DB.prepare('SELECT consumed_at FROM submitter_tokens WHERE id = ?')
      .bind('token-1')
      .first()
    expect(token?.consumed_at).toBeNull()
    expect(await countRows(env.DB, 'sessions')).toBe(0)
  })
})
