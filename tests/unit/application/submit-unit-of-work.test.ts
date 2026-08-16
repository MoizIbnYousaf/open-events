import { describe, expect, it } from 'vitest'

import { SubmitService, type SubmitInput } from '../../../src/application'
import type {
  SubmitBatchInput,
  SubmitBatchResult,
  SubmitUnitOfWork,
} from '../../../src/application'
import { MAX_CO_SPEAKERS, type ProposalSubmission } from '../../../src/domain'
import {
  DRAFT_ID,
  EVENT_ID,
  FIXED_NOW,
  FORM_ID,
  NOW,
  VERSION_ID,
  createContent,
  createDraft,
  createForm,
  createSubmission,
  createSubmitterActor,
  createVersion,
  openLimits,
  ownerContact,
} from '../helpers/fixtures'

const ownerActor = createSubmitterActor({ capability: 'cfp' })
const foreignActor = createSubmitterActor({ capability: 'cfp', contactId: 'contact-other' })
const crossEventActor = createSubmitterActor({ capability: 'cfp', eventId: 'event-other' })
import {
  InMemoryCapturedMessageRepository,
  InMemoryConfirmationRepository,
  InMemoryContactRepository,
  InMemoryDraftRepository,
  InMemoryFormContentRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemorySubmissionRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySubmitUnitOfWork } from '../helpers/in-memory-unit-of-work'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

type ScriptedOutcome = 'inserted' | 'closed' | 'capped' | 'identity-limited'

/**
 * In-memory port implementation mirroring the D1 adapter contract: the
 * idempotency decision lives here (unique originDraftId), not in a service
 * pre-check.
 */
class ScriptedSubmitUnitOfWork implements SubmitUnitOfWork {
  readonly calls: SubmitBatchInput[] = []
  readonly inserted: ProposalSubmission[] = []
  readonly #outcomes: ScriptedOutcome[]

  constructor(outcomes: readonly ScriptedOutcome[] = []) {
    this.#outcomes = [...outcomes]
  }

  async recoverHandoff(): Promise<{ readonly outcome: 'handoff-invalid' }> {
    return { outcome: 'handoff-invalid' }
  }

  async execute(input: SubmitBatchInput): Promise<SubmitBatchResult> {
    this.calls.push(input)
    const duplicate = this.inserted.find(
      (submission) => submission.originDraftId === input.originDraftId,
    )
    if (duplicate !== undefined) {
      return { outcome: 'existing-idempotent', submission: duplicate }
    }
    const outcome = this.#outcomes.shift() ?? 'inserted'
    if (outcome === 'inserted') {
      this.inserted.push(input.submission)
      return { outcome: 'inserted', submission: input.submission }
    }
    return { outcome }
  }
}

function buildHarness(outcomes: readonly ScriptedOutcome[] = []) {
  const form = createForm({
    status: 'published',
    publishedVersionId: VERSION_ID,
    limits: openLimits,
  })
  const version = createVersion({
    status: 'published',
    contentHash: 'a'.repeat(64),
    publishedAt: NOW,
  })
  const drafts = new InMemoryDraftRepository([createDraft()])
  const versions = new InMemoryFormVersionRepository([version])
  const forms = new InMemoryFormRepository([form])
  const formContent = new InMemoryFormContentRepository([[EVENT_ID, VERSION_ID, createContent()]])
  const submissions = new InMemorySubmissionRepository(versions)
  const contacts = new InMemoryContactRepository([ownerContact])
  const unitOfWork = new ScriptedSubmitUnitOfWork(outcomes)
  const service = new SubmitService(
    drafts,
    submissions,
    contacts,
    forms,
    versions,
    formContent,
    unitOfWork,
    { now: () => FIXED_NOW },
  )
  return { service, unitOfWork, drafts, submissions, contacts }
}

function submitInput(overrides: Partial<SubmitInput> = {}): SubmitInput {
  return {
    originDraftId: DRAFT_ID,
    formVersionId: VERSION_ID,
    title: 'Hands-on workshop proposal',
    answers: {
      title: 'Hands-on workshop proposal',
      format: 'workshop',
      'contact-email': 'speaker-a@example.test',
      workshop: 'Bring a laptop',
      attendees: 25,
      topics: ['ai'],
    },
    coSpeakers: [],
    ...overrides,
  }
}

describe('SubmitService with an injected SubmitUnitOfWork', () => {
  it('delegates the entire decision and write batch to the port on inserted', async () => {
    const { service, unitOfWork, drafts } = buildHarness()

    const detail = await service.submit(
      ownerActor,
      submitInput({ coSpeakers: [{ name: 'Co Speaker', email: 'co@example.test' }] }),
    )

    expect(detail.status).toBe('pending')
    expect(unitOfWork.calls).toHaveLength(1)
    const batch = unitOfWork.calls[0]
    expect(batch?.eventId).toBe(EVENT_ID)
    expect(batch?.formId).toBe('form-cfp')
    expect(batch?.originDraftId).toBe(DRAFT_ID)
    expect(batch?.ownerContactId).toBe(ownerActor.contactId)
    expect(batch?.submittedAt).toBe(FIXED_NOW)
    expect(batch?.submission.id).toBe(detail.id)
    expect(batch?.coSpeakers).toEqual([{ name: 'Co Speaker', email: 'co@example.test' }])
    expect(batch).not.toHaveProperty('contributors')
    expect(batch?.confirmation.submissionId).toBe(detail.id)
    expect(batch?.message.toEmail).toBe('speaker-a@example.test')
    // The service performs no separate writes: the port is the unit of work.
    expect(drafts.list()).toHaveLength(1)
  })

  it('returns the existing submission when the port reports existing-idempotent', async () => {
    const { service, unitOfWork } = buildHarness()
    await service.submit(ownerActor, submitInput())
    const existing = createSubmission({ id: 'submission-existing' })
    unitOfWork.inserted.length = 0
    unitOfWork.inserted.push(existing)

    const retry = await service.submit(ownerActor, submitInput())

    expect(retry.id).toBe('submission-existing')
    expect(unitOfWork.calls).toHaveLength(2)
  })

  it('denies an existing-idempotent result owned by another actor or event', async () => {
    const foreignHarness = buildHarness()
    foreignHarness.unitOfWork.inserted.push(
      createSubmission({ id: 'submission-foreign', ownerContactId: 'contact-other' }),
    )
    await expect(foreignHarness.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'not_found',
    })

    const crossHarness = buildHarness()
    crossHarness.unitOfWork.inserted.push(
      createSubmission({ id: 'submission-cross', eventId: 'event-other' }),
    )
    await expect(crossHarness.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('keeps idempotency in the port: a duplicate originDraftId never re-inserts', async () => {
    const { service, unitOfWork } = buildHarness()

    const first = await service.submit(ownerActor, submitInput())
    const retry = await service.submit(ownerActor, submitInput())

    expect(retry.id).toBe(first.id)
    expect(unitOfWork.inserted).toHaveLength(1)
    expect(unitOfWork.calls).toHaveLength(2)
    expect(unitOfWork.calls[1]?.originDraftId).toBe(DRAFT_ID)
  })

  it('maps closed, capped, and identity-limited port outcomes to typed errors', async () => {
    const closed = buildHarness(['closed'])
    const capped = buildHarness(['capped'])
    const identityLimited = buildHarness(['identity-limited'])

    await expect(closed.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_closed',
    })
    await expect(capped.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_capped',
    })
    await expect(identityLimited.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'identity_limit_reached',
    })
  })

  it('lets a port-observed cap win even when local counts would allow the submit', async () => {
    const { service, unitOfWork, drafts } = buildHarness(['capped'])

    await expect(service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_capped',
    })
    expect(unitOfWork.calls).toHaveLength(1)
    expect(drafts.list()).toHaveLength(1)
  })

  it('creates no contacts when the port reports a rejection', async () => {
    const { service, contacts, unitOfWork } = buildHarness(['capped', 'closed', 'identity-limited'])

    await service
      .submit(ownerActor, submitInput({ coSpeakers: [{ name: 'Co', email: 'co@example.test' }] }))
      .catch(() => undefined)
    await service
      .submit(ownerActor, submitInput({ coSpeakers: [{ name: 'Co', email: 'co@example.test' }] }))
      .catch(() => undefined)
    await service
      .submit(ownerActor, submitInput({ coSpeakers: [{ name: 'Co', email: 'co@example.test' }] }))
      .catch(() => undefined)

    expect(contacts.list()).toHaveLength(1)
    expect(unitOfWork.calls).toHaveLength(3)
  })

  it('rejects a foreign actor retry without disclosing the existing submission', async () => {
    const { service, unitOfWork } = buildHarness()
    const victim = createSubmission({ id: 'submission-victim' })
    unitOfWork.inserted.push(victim)

    await expect(service.submit(foreignActor, submitInput())).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(service.submit(crossEventActor, submitInput())).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('in-memory SubmitUnitOfWork co-speaker cap', () => {
  it(`rejects more than MAX_CO_SPEAKERS (${MAX_CO_SPEAKERS}) before any mutation`, async () => {
    const drafts = new InMemoryDraftRepository([createDraft()])
    const versions = new InMemoryFormVersionRepository([
      createVersion({ status: 'published', contentHash: 'a'.repeat(64), publishedAt: NOW }),
    ])
    const forms = new InMemoryFormRepository([
      createForm({ status: 'published', publishedVersionId: VERSION_ID, limits: openLimits }),
    ])
    const submissions = new InMemorySubmissionRepository(versions)
    const contacts = new InMemoryContactRepository([ownerContact])
    const messages = new InMemoryCapturedMessageRepository()
    const confirmations = new InMemoryConfirmationRepository()
    const unitOfWork = new InMemorySubmitUnitOfWork({
      forms,
      versions,
      submissions,
      contacts,
      messages,
      confirmations,
      drafts,
    })
    const submission = createSubmission()
    const tooMany = Array.from({ length: MAX_CO_SPEAKERS + 1 }, (_, index) => ({
      name: `Co ${index}`,
      email: `co-${index}@example.test`,
    }))
    const batch: SubmitBatchInput = {
      eventId: EVENT_ID,
      formId: FORM_ID,
      originDraftId: submission.originDraftId,
      ownerContactId: submission.ownerContactId,
      submittedAt: FIXED_NOW,
      submission,
      coSpeakers: tooMany,
      confirmation: {
        id: 'confirmation-1',
        eventId: EVENT_ID,
        submissionId: submission.id,
        capturedMessageId: 'message-1',
        createdAt: FIXED_NOW,
      },
      message: {
        id: 'message-1',
        eventId: EVENT_ID,
        toEmail: ownerContact.email,
        subject: 's',
        body: 'b',
        createdAt: FIXED_NOW,
        kind: 'confirmation' as const,
      },
    }

    await expect(unitOfWork.execute(batch)).rejects.toThrow(
      `A submission may include at most ${MAX_CO_SPEAKERS} co-speakers`,
    )

    expect(contacts.list()).toHaveLength(1)
    expect(submissions.list()).toEqual([])
    expect(drafts.list()).toHaveLength(1)
    expect(messages.list()).toEqual([])
    expect(confirmations.list()).toEqual([])
  })
})
