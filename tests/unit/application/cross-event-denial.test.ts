import { describe, expect, it } from 'vitest'

import {
  DraftService,
  SubmitService,
  toSubmitterActor,
  type SubmitInput,
} from '../../../src/application'
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
  createSubmitterSession,
  createSubmitterActor,
  createVersion,
  openLimits,
  ownerContact,
} from '../helpers/fixtures'

const ownerActor = createSubmitterActor({ capability: 'cfp' })
const crossEventActor = createSubmitterActor({ capability: 'cfp', eventId: 'event-other' })
const portalOwnerActor = createSubmitterActor({ capability: 'portal' })
const portalCrossEventActor = createSubmitterActor({ capability: 'portal', eventId: 'event-other' })
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
  const contacts = new InMemoryContactRepository([ownerContact])
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
  const submitService = new SubmitService(
    drafts,
    submissions,
    contacts,
    forms,
    versions,
    formContent,
    unitOfWork,
    { now: () => FIXED_NOW },
  )
  const draftService = new DraftService(drafts, new InMemoryFormRepository([form]), versions, {
    now: () => FIXED_NOW,
  })
  return { submitService, draftService, drafts, submissions, messages, contacts }
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

describe('cross-event denial for SubmitterActor', () => {
  it('denies draft creation, updates, and reads across events', async () => {
    const { draftService, drafts } = buildHarness()

    await expect(
      draftService.save(crossEventActor, {
        id: null,
        formId: FORM_ID,
        formVersionId: VERSION_ID,
        title: 'Cross-event draft',
        answers: {},
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      draftService.save(crossEventActor, {
        id: DRAFT_ID,
        formId: FORM_ID,
        formVersionId: VERSION_ID,
        title: 'x',
        answers: {},
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await draftService.get(crossEventActor, DRAFT_ID)).toBeNull()
    expect(await draftService.getActiveDraft(crossEventActor, FORM_ID)).toBeNull()
    expect(await draftService.listByOwner(crossEventActor)).toEqual([])
    expect(drafts.list()).toHaveLength(1)
  })

  it('denies submits and submission reads across events with zero writes', async () => {
    const { submitService, submissions, messages } = buildHarness()

    await expect(submitService.submit(crossEventActor, submitInput())).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(submissions.list()).toEqual([])
    expect(messages.list()).toEqual([])

    const victim = await submitService.submit(ownerActor, submitInput())
    expect(await submitService.getOwnDetail(portalCrossEventActor, victim.id)).toBeNull()
    expect(await submitService.getOwnDetail(portalOwnerActor, victim.id)).toMatchObject({
      id: victim.id,
    })
  })

  it('binds a redeemed session to its issuing event end to end', async () => {
    const { draftService } = buildHarness()
    const session = createSubmitterSession({
      capability: 'cfp',
      contactId: ownerActor.contactId,
      eventId: ownerActor.eventId,
    })
    const actorFromSession = toSubmitterActor(session)
    const crossEventFromSession = toSubmitterActor(
      createSubmitterSession({ capability: 'cfp', eventId: 'event-other' }),
    )

    expect(actorFromSession).not.toBeNull()
    expect(crossEventFromSession).not.toBeNull()
    expect(await draftService.get(actorFromSession!, DRAFT_ID)).toMatchObject({ id: DRAFT_ID })
    expect(await draftService.get(crossEventFromSession!, DRAFT_ID)).toBeNull()
  })
})
