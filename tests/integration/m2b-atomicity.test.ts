import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import {
  createFormBuilderUnitOfWork,
  createSessionUnitOfWork as createD1SessionUnitOfWork,
  createSubmitUnitOfWork as createD1SubmitUnitOfWork,
} from '../../src/db'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import type { CfpForm, FormVersion } from '../../src/domain'
import { NOW } from '../unit/helpers/fixtures'
import {
  SEEDED_CONTACTS,
  TEST_EMAIL_DELIVERY_CONFIG,
  applyMigrations,
  buildSubmitBatch,
  countRows,
  seedDemoConf,
} from './m2b-helpers'

const createSessionUnitOfWork = (db: D1Database) =>
  createD1SessionUnitOfWork(db, TEST_EMAIL_DELIVERY_CONFIG)
const createSubmitUnitOfWork = (db: D1Database) =>
  createD1SubmitUnitOfWork(db, TEST_EMAIL_DELIVERY_CONFIG)

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
    expect(await countRows(env.DB, 'email_delivery_jobs')).toBe(0)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(0)
    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + 1)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(1)
  })

  it('rolls back the business commit when the portal handoff write fails downstream', async () => {
    await seedOwnerAndDraft()
    await env.DB.prepare(
      `INSERT INTO sessions
         (id, kind, contact_id, event_id, capability, token_hash,
          expires_at, consumed_at, created_at)
       VALUES ('cfp-session-atomic', 'submitter', 'contact-speaker-a', ?, 'cfp', ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, 'c'.repeat(64), FUTURE, NOW)
      .run()
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    const batch = buildSubmitBatch()

    await expect(
      unitOfWork.execute({
        ...batch,
        handoff: {
          cfpSessionId: 'cfp-session-atomic',
          requestHash: 'd'.repeat(64),
          source: { kind: 'cfp' },
          portalSession: {
            id: 'portal-session-invalid',
            kind: 'submitter',
            contactId: 'contact-speaker-a',
            eventId: DEMO_CONF_2026_ID,
            capability: 'portal',
            // The sessions CHECK is the forced downstream failure.
            tokenHash: 'too-short',
            expiresAt: FUTURE,
            consumedAt: null,
            createdAt: NOW,
            provenance: 'ordinary',
          },
        },
      }),
    ).rejects.toThrow()

    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(0)
    expect(await countRows(env.DB, 'submit_session_handoffs')).toBe(0)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(1)
    expect(
      await env.DB.prepare('SELECT consumed_at FROM sessions WHERE id = ?')
        .bind('cfp-session-atomic')
        .first(),
    ).toEqual({ consumed_at: null })
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
      purpose: 'public',
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
      `INSERT INTO submitter_tokens (id, event_id, contact_id, form_id, purpose, token_hash,
                                       expires_at, consumed_at, created_at)
         VALUES ('token-1', ?, 'contact-speaker-a', ?, 'cfp', ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_FORM_ID, 'a'.repeat(64), FUTURE, NOW)
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
          capability: 'cfp',
          tokenHash: 'b'.repeat(64),
          expiresAt: 'bad-instant',
          consumedAt: null,
          createdAt: NOW,
          provenance: 'ordinary',
        },
      }),
    ).rejects.toThrow()

    const token = await env.DB.prepare('SELECT consumed_at FROM submitter_tokens WHERE id = ?')
      .bind('token-1')
      .first()
    expect(token?.consumed_at).toBeNull()
    expect(await countRows(env.DB, 'sessions')).toBe(0)
  })

  it('rolls back a role token when its captured message cannot be persisted', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-role', 'role@example.test', 'Role', NOW)
      .run()
    await env.DB.prepare(
      'INSERT INTO evaluation_committee_members (event_id, contact_id, added_at) VALUES (?, ?, ?)',
    )
      .bind(DEMO_CONF_2026_ID, 'contact-role', NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO captured_messages
         (id, event_id, to_email, subject, body, created_at, kind, submission_id)
       VALUES ('message-conflict', ?, 'existing@example.test', 'Existing', 'Existing', ?, 'reminder', NULL)`,
    )
      .bind(DEMO_CONF_2026_ID, NOW)
      .run()
    const unitOfWork = createSessionUnitOfWork(env.DB)

    await expect(
      unitOfWork.issueRoleAccess({
        token: {
          id: 'role-token-atomic',
          eventId: DEMO_CONF_2026_ID,
          contactId: 'contact-role',
          formId: null,
          purpose: 'evaluation',
          tokenHash: 'e'.repeat(64),
          expiresAt: FUTURE,
          consumedAt: null,
          createdAt: NOW,
        },
        message: {
          id: 'message-conflict',
          eventId: DEMO_CONF_2026_ID,
          toEmail: 'role@example.test',
          subject: 'Portal access',
          body: 'Private link',
          createdAt: NOW,
          kind: 'reminder',
          submissionId: null,
        },
        proof: { kind: 'committee-member' },
      }),
    ).rejects.toThrow()

    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM submitter_tokens WHERE id = ?')
        .bind('role-token-atomic')
        .first(),
    ).toEqual({ n: 0 })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM email_delivery_jobs WHERE id = ?')
        .bind('message-conflict')
        .first(),
    ).toEqual({ n: 0 })
  })

  it('refuses role-token persistence when the contact lacks the supplied event role proof', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-unseated', 'unseated@example.test', 'Unseated', NOW)
      .run()
    const unitOfWork = createSessionUnitOfWork(env.DB)

    const result = await unitOfWork.issueRoleAccess({
      token: {
        id: 'role-token-unproven',
        eventId: DEMO_CONF_2026_ID,
        contactId: 'contact-unseated',
        formId: null,
        purpose: 'evaluation',
        tokenHash: 'f'.repeat(64),
        expiresAt: FUTURE,
        consumedAt: null,
        createdAt: NOW,
      },
      message: {
        id: 'message-unproven',
        eventId: DEMO_CONF_2026_ID,
        toEmail: 'unseated@example.test',
        subject: 'Evaluation access',
        body: 'Private link',
        createdAt: NOW,
        kind: 'reminder',
        submissionId: null,
      },
      proof: { kind: 'committee-member' },
    })

    expect(result).toEqual({ outcome: 'conflict' })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM submitter_tokens WHERE id = ?')
        .bind('role-token-unproven')
        .first(),
    ).toEqual({ n: 0 })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM captured_messages WHERE id = ?')
        .bind('message-unproven')
        .first(),
    ).toEqual({ n: 0 })
  })

  it('refuses cross-event committee proof and contact-email substitution', async () => {
    await env.DB.prepare(
      "INSERT INTO events (id, slug, name, timezone, status) VALUES (?, ?, ?, 'UTC', 'published')",
    )
      .bind('event-other', 'other-event', 'Other Event')
      .run()
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-other-reviewer', 'other-reviewer@example.test', 'Other Reviewer', NOW)
      .run()
    await env.DB.prepare(
      'INSERT INTO evaluation_committee_members (event_id, contact_id, added_at) VALUES (?, ?, ?)',
    )
      .bind('event-other', 'contact-other-reviewer', NOW)
      .run()
    const unitOfWork = createSessionUnitOfWork(env.DB)

    const crossEvent = await unitOfWork.issueRoleAccess({
      token: {
        id: 'role-token-cross-event',
        eventId: DEMO_CONF_2026_ID,
        contactId: 'contact-other-reviewer',
        formId: null,
        purpose: 'evaluation',
        tokenHash: '1'.repeat(64),
        expiresAt: FUTURE,
        consumedAt: null,
        createdAt: NOW,
      },
      message: {
        id: 'message-cross-event',
        eventId: DEMO_CONF_2026_ID,
        toEmail: 'other-reviewer@example.test',
        subject: 'Evaluation access',
        body: 'Private link',
        createdAt: NOW,
        kind: 'reminder',
        submissionId: null,
      },
      proof: { kind: 'committee-member' },
    })

    await env.DB.prepare(
      'INSERT INTO evaluation_committee_members (event_id, contact_id, added_at) VALUES (?, ?, ?)',
    )
      .bind(DEMO_CONF_2026_ID, 'contact-other-reviewer', NOW)
      .run()
    const wrongContactEmail = await unitOfWork.issueRoleAccess({
      token: {
        id: 'role-token-email-substitution',
        eventId: DEMO_CONF_2026_ID,
        contactId: 'contact-other-reviewer',
        formId: null,
        purpose: 'evaluation',
        tokenHash: '2'.repeat(64),
        expiresAt: FUTURE,
        consumedAt: null,
        createdAt: NOW,
      },
      message: {
        id: 'message-email-substitution',
        eventId: DEMO_CONF_2026_ID,
        toEmail: 'speaker-a@example.test',
        subject: 'Evaluation access',
        body: 'Private link',
        createdAt: NOW,
        kind: 'reminder',
        submissionId: null,
      },
      proof: { kind: 'committee-member' },
    })

    expect(crossEvent).toEqual({ outcome: 'conflict' })
    expect(wrongContactEmail).toEqual({ outcome: 'conflict' })
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM submitter_tokens WHERE id IN ('role-token-cross-event', 'role-token-email-substitution')",
      ).first(),
    ).toEqual({ n: 0 })
  })
})
