import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { SubmitService, toSubmitterActor, type SubmitInput } from '../../src/application'
import {
  createContactRepository,
  createDraftRepository,
  createFormContentRepository,
  createFormRepository,
  createFormVersionRepository,
  createSubmissionRepository,
  createSubmitUnitOfWork,
} from '../../src/db'
import { DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { MAX_CO_SPEAKERS } from '../../src/domain'
import { FIXED_NOW, NOW, createSubmitterSession } from '../unit/helpers/fixtures'
import {
  SEEDED_CONTACTS,
  SEEDED_WORKSHOP_ANSWERS,
  applyMigrations,
  buildSubmitBatch,
  countRows,
  expectRejects,
  seedDemoConf,
} from './m2b-helpers'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
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
})

describe('originDraftId idempotent retry', () => {
  it('returns the existing submission with zero extra writes on retry', async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    const first = await unitOfWork.execute(
      buildSubmitBatch({
        coSpeakers: [
          { name: 'Co A', email: 'co-a@example.test' },
          { name: 'Co B', email: 'co-b@example.test' },
        ],
      }),
    )
    expect(first.outcome).toBe('inserted')
    if (first.outcome !== 'inserted') return

    const retry = await unitOfWork.execute(
      buildSubmitBatch({
        submissionId: 'submission-2',
        title: 'A different title that must not be written',
        coSpeakers: [{ name: 'Co C', email: 'co-c@example.test' }],
      }),
    )

    expect(retry.outcome).toBe('existing-idempotent')
    if (retry.outcome === 'existing-idempotent') {
      expect(retry.submission.id).toBe(first.submission.id)
      expect(retry.submission.title).toBe('Workshop proposal')
      expect(retry.submission.answers).toEqual(first.submission.answers)
      expect(retry.submission.contentHash).toBe(first.submission.contentHash)
      expect(retry.submission.routing).toEqual(first.submission.routing)
      expect(retry.submission.submittedAt).toBe(first.submission.submittedAt)
      expect(retry.submission.createdAt).toBe(first.submission.createdAt)
      expect(retry.submission.eventId).toBe(first.submission.eventId)
      expect(retry.submission.ownerContactId).toBe(first.submission.ownerContactId)
    }
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'submission_contributors')).toBe(3)
    expect(await countRows(env.DB, 'captured_messages')).toBe(1)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(1)
    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + 3)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(0)
  })

  it('decodes the existing row JSON fields faithfully (arrays, numbers, routing)', async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    const first = await unitOfWork.execute(
      buildSubmitBatch({
        submissionId: 'submission-json',
        title: 'JSON fidelity',
        coSpeakers: [{ name: 'Co A', email: 'co-a@example.test' }],
      }),
    )
    expect(first.outcome).toBe('inserted')
    if (first.outcome !== 'inserted') return

    const retry = await unitOfWork.execute(buildSubmitBatch({ submissionId: 'submission-json-2' }))

    expect(retry.outcome).toBe('existing-idempotent')
    if (retry.outcome === 'existing-idempotent') {
      expect(retry.submission.answers).toEqual(SEEDED_WORKSHOP_ANSWERS)
      expect(retry.submission.routing).toEqual({
        actionKind: 'assign_track',
        actionTarget: 'platform-infra',
      })
    }
  })

  it('preserves array and numeric answer values plus routing on the raw existing row', async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    const answers = {
      format: 'workshop',
      title: 'Talk with topics',
      topics: ['ai', 'web'],
      attendees: 25,
    }
    const first = await unitOfWork.execute(
      buildSubmitBatch({
        submissionId: 'submission-complex',
        title: 'Talk with topics',
        answers,
      }),
    )
    expect(first.outcome).toBe('inserted')
    if (first.outcome !== 'inserted') return

    const retry = await unitOfWork.execute(
      buildSubmitBatch({ submissionId: 'submission-complex-2' }),
    )

    expect(retry.outcome).toBe('existing-idempotent')
    if (retry.outcome === 'existing-idempotent') {
      expect(retry.submission.answers).toEqual(answers)
      expect(retry.submission.routing).toEqual({
        actionKind: 'assign_track',
        actionTarget: 'platform-infra',
      })
    }
  })

  it('returns the raw existing row for a foreign origin without throwing or writing', async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    await unitOfWork.execute(buildSubmitBatch())

    const foreignEvent = await unitOfWork.execute(
      buildSubmitBatch({
        submissionId: 'submission-foreign-event',
        eventId: 'event-other',
        coSpeakers: [{ name: 'Co X', email: 'co-x@example.test' }],
      }),
    )
    expect(foreignEvent.outcome).toBe('existing-idempotent')

    const foreignOwner = await unitOfWork.execute(
      buildSubmitBatch({
        submissionId: 'submission-foreign-owner',
        ownerContactId: 'contact-other',
      }),
    )
    expect(foreignOwner.outcome).toBe('existing-idempotent')

    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + 1)
    expect(await countRows(env.DB, 'captured_messages')).toBe(1)
  })

  it('rejects an event-mismatched submit batch before writing anything', async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    const batch = buildSubmitBatch()

    await expect(
      unitOfWork.execute({ ...batch, message: { ...batch.message, eventId: 'event-other' } }),
    ).rejects.toThrow(/message must belong to the actor event/)
    await expect(
      unitOfWork.execute({
        ...batch,
        confirmation: { ...batch.confirmation, eventId: 'event-other' },
      }),
    ).rejects.toThrow(/confirmation must belong to the actor event/)

    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(0)
    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + 1)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(1)
  })

  it(`rejects more than MAX_CO_SPEAKERS (${MAX_CO_SPEAKERS}) co-speakers with zero writes`, async () => {
    const service = buildService()
    const tooMany = Array.from({ length: MAX_CO_SPEAKERS + 1 }, (_, index) => ({
      name: `Co ${index}`,
      email: `co-${index}@example.test`,
    }))

    await expect(
      service.submit(actor(), buildInput({ coSpeakers: tooMany })),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + 1)
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(0)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(1)
  })

  it(`accepts exactly MAX_CO_SPEAKERS (${MAX_CO_SPEAKERS}) co-speakers`, async () => {
    const service = buildService()
    const exact = Array.from({ length: MAX_CO_SPEAKERS }, (_, index) => ({
      name: `Co ${index}`,
      email: `co-${index}@example.test`,
    }))

    const detail = await service.submit(actor(), buildInput({ coSpeakers: exact }))

    expect(detail.status).toBe('pending')
    expect(detail.contributors).toHaveLength(MAX_CO_SPEAKERS + 1)
    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + MAX_CO_SPEAKERS + 1)
    expect(await countRows(env.DB, 'submission_contributors')).toBe(MAX_CO_SPEAKERS + 1)
  })

  it(`rejects ${MAX_CO_SPEAKERS + 1} co-speakers at the direct UoW boundary with every table unchanged`, async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    const tooMany = Array.from({ length: MAX_CO_SPEAKERS + 1 }, (_, index) => ({
      name: `Co ${index}`,
      email: `co-${index}@example.test`,
    }))

    await expect(unitOfWork.execute(buildSubmitBatch({ coSpeakers: tooMany }))).rejects.toThrow(
      `A submission may include at most ${MAX_CO_SPEAKERS} co-speakers`,
    )

    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + 1)
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
    expect(await countRows(env.DB, 'submission_contributors')).toBe(0)
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(0)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(1)
    expect(await countRows(env.DB, 'submitter_tokens')).toBe(0)
    expect(await countRows(env.DB, 'sessions')).toBe(0)
  })

  it(`accepts exactly ${MAX_CO_SPEAKERS} co-speakers at the direct UoW boundary end to end`, async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    const exact = Array.from({ length: MAX_CO_SPEAKERS }, (_, index) => ({
      name: `Co ${index}`,
      email: `co-${index}@example.test`,
    }))

    const result = await unitOfWork.execute(buildSubmitBatch({ coSpeakers: exact }))

    expect(result.outcome).toBe('inserted')
    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + MAX_CO_SPEAKERS + 1)
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'submission_contributors')).toBe(MAX_CO_SPEAKERS + 1)
    expect(await countRows(env.DB, 'captured_messages')).toBe(1)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(1)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(0)
  })

  it('is backstopped by the UNIQUE origin_draft_id constraint', async () => {
    const unitOfWork = createSubmitUnitOfWork(env.DB)
    await unitOfWork.execute(buildSubmitBatch())

    await expectRejects(
      env.DB,
      `INSERT INTO proposal_submissions (id, event_id, owner_contact_id, form_version_id,
                                         origin_draft_id, status, title, answers_json,
                                         content_hash, routing_json, created_at, submitted_at)
       VALUES ('submission-dup', ?, 'contact-speaker-a', ?, 'draft-origin-1', 'pending',
               't', '{}', ?, NULL, ?, ?)`,
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
      'a'.repeat(64),
      NOW,
      NOW,
    )
  })
})

function actor() {
  return toSubmitterActor(
    createSubmitterSession({
      contactId: 'contact-speaker-a',
      eventId: DEMO_CONF_2026_ID,
    }),
  )!
}

function buildInput(overrides: Partial<SubmitInput> = {}): SubmitInput {
  return {
    originDraftId: 'draft-origin-1',
    formVersionId: DEMO_CONF_2026_VERSION_ID,
    title: 'Workshop proposal',
    answers: SEEDED_WORKSHOP_ANSWERS,
    coSpeakers: [],
    ...overrides,
  }
}

function buildService(): SubmitService {
  return new SubmitService(
    createDraftRepository(env.DB),
    createSubmissionRepository(env.DB),
    createContactRepository(env.DB),
    createFormRepository(env.DB),
    createFormVersionRepository(env.DB),
    createFormContentRepository(env.DB),
    createSubmitUnitOfWork(env.DB),
    { now: () => FIXED_NOW },
  )
}
