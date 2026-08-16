import { describe, expect, it } from 'vitest'

import { SubmitService, type SubmitInput } from '../../../src/application'
import {
  DRAFT_ID,
  EVENT_ID,
  FIXED_NOW,
  NOW,
  VERSION_ID,
  createContent,
  createDraft,
  createForm,
  createSubmission,
  createSubmitterActor,
  createVersion,
  crossEventActor as portalCrossEventActor,
  openLimits,
  organizerActor,
  ownerActor as portalOwnerActor,
  ownerContact,
} from '../helpers/fixtures'
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

const cfpOwnerActor = createSubmitterActor({ capability: 'cfp' })

function buildHarness() {
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
  const contacts = new InMemoryContactRepository([
    ownerContact,
    {
      id: 'contact-other',
      email: 'other@example.test',
      name: 'Other Speaker',
      createdAt: NOW,
    },
  ])
  const confirmations = new InMemoryConfirmationRepository()
  const messages = new InMemoryCapturedMessageRepository()
  const unitOfWork = new InMemorySubmitUnitOfWork({
    forms,
    versions,
    submissions,
    contacts,
    messages,
    confirmations,
    drafts,
  })
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
  return { service, submissions }
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

async function seedForeignSubmission(harness: ReturnType<typeof buildHarness>) {
  const other = createSubmission({
    id: 'submission-other',
    ownerContactId: 'contact-other',
    originDraftId: 'draft-other',
  })
  await harness.submissions.save(other)
  await harness.submissions.saveContributors(EVENT_ID, other.id, [
    {
      submissionId: other.id,
      eventId: EVENT_ID,
      contactId: 'contact-other',
      role: 'primary',
      position: 0,
    },
  ])
  return other
}

describe('submission detail authorization', () => {
  it('lets an organizer read any event submission but never a cross-event id', async () => {
    const { service } = buildHarness()
    const detail = await service.submit(cfpOwnerActor, submitInput())

    expect(await service.getDetailForEvent(organizerActor, EVENT_ID, detail.id)).toMatchObject({
      id: detail.id,
      eventId: EVENT_ID,
    })
    expect(await service.getDetailForEvent(organizerActor, 'event-other', detail.id)).toBeNull()
    expect(await service.getDetailForEvent(organizerActor, EVENT_ID, 'submission-ghost')).toBeNull()
  })

  it('lets a submitter read only their own submission within their event', async () => {
    const { service, submissions } = buildHarness()
    const own = await service.submit(cfpOwnerActor, submitInput())
    await seedForeignSubmission({ service, submissions })
    await submissions.save(
      createSubmission({
        id: 'submission-cross-event',
        eventId: 'event-other',
        originDraftId: 'draft-cross',
      }),
    )

    expect(await service.getOwnDetail(portalOwnerActor, own.id)).toMatchObject({ id: own.id })
    expect(await service.getOwnDetail(portalOwnerActor, 'submission-other')).toBeNull()
    expect(await service.getOwnDetail(portalOwnerActor, 'submission-cross-event')).toBeNull()
    expect(
      await service.getOwnDetail(portalCrossEventActor, 'submission-cross-event'),
    ).toMatchObject({
      id: 'submission-cross-event',
    })
    expect(await service.getOwnDetail(portalOwnerActor, 'submission-ghost')).toBeNull()
  })

  it('keeps the organizer event view separate from submitter-owned retrieval', async () => {
    const { service, submissions } = buildHarness()
    const other = await seedForeignSubmission({ service, submissions })

    expect(await service.getDetailForEvent(organizerActor, EVENT_ID, other.id)).not.toBeNull()
    expect(await service.getOwnDetail(portalOwnerActor, other.id)).toBeNull()
    expect((await service.listByEvent(organizerActor, EVENT_ID)).map((item) => item.id)).toEqual([
      other.id,
    ])
    expect(await service.listByEvent(organizerActor, 'event-other')).toEqual([])
  })

  it('prints the standing decision on the organizer list after a verdict is recorded', async () => {
    const { service, submissions } = buildHarness()
    const other = await seedForeignSubmission({ service, submissions })

    expect((await service.listByEvent(organizerActor, EVENT_ID))[0]?.decision).toBe('pending')
    expect(
      await submissions.recordDecision({
        id: 'decision-1',
        eventId: EVENT_ID,
        submissionId: other.id,
        outcome: 'accepted',
        decidedBy: 'organizer',
        decidedAt: FIXED_NOW,
      }),
    ).toBe('recorded')
    expect((await service.listByEvent(organizerActor, EVENT_ID))[0]?.decision).toBe('accepted')
  })
})
