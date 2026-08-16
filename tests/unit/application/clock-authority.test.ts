import { describe, expect, it } from 'vitest'

import {
  DraftService,
  FormBuilderService,
  SessionService,
  SubmitService,
  type SubmitInput,
} from '../../../src/application'
import {
  DRAFT_ID,
  EVENT_ID,
  FORM_ID,
  NOW,
  VERSION_ID,
  createContent,
  createDraft,
  createForm,
  createSubmitterActor,
  createSubmitterToken,
  createTaxonomyItem,
  createVersion,
  eventFixture,
  openLimits,
  organizerActor,
  ownerContact,
} from '../helpers/fixtures'

const ownerActor = createSubmitterActor({ capability: 'cfp' })
import {
  InMemoryCapturedMessageRepository,
  InMemoryConfirmationRepository,
  InMemoryContactRepository,
  InMemoryDraftRepository,
  InMemoryEventRepository,
  InMemoryFormContentRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemorySessionRepository,
  InMemorySubmissionRepository,
  InMemoryTaxonomyRepository,
  InMemoryTokenRepository,
} from '../helpers/in-memory-repositories'
import {
  InMemoryFormBuilderUnitOfWork,
  InMemorySessionUnitOfWork,
  InMemorySubmitUnitOfWork,
} from '../helpers/in-memory-unit-of-work'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

const CLOCK_A = '2026-05-20T09:00:00.000Z'
const CLOCK_B = '2026-05-21T09:00:00.000Z'

function submitInput(): SubmitInput {
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
  }
}

function buildSubmitHarness(clockNow: string) {
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
  const content = new InMemoryFormContentRepository([[EVENT_ID, VERSION_ID, createContent()]])
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
  const service = new SubmitService(
    drafts,
    submissions,
    contacts,
    forms,
    versions,
    content,
    unitOfWork,
    { now: () => clockNow },
  )
  return { service, submissions }
}

describe('server Clock authority', () => {
  it('derives submittedAt and gate instants from the submit service clock', async () => {
    const a = buildSubmitHarness(CLOCK_A)
    const detailA = await a.service.submit(ownerActor, submitInput())
    expect(a.submissions.list()[0]?.submittedAt).toBe(CLOCK_A)

    const b = buildSubmitHarness(CLOCK_B)
    const detailB = await b.service.submit(ownerActor, submitInput())
    expect(b.submissions.list()[0]?.submittedAt).toBe(CLOCK_B)
    expect(detailA.submittedAt).not.toBe(detailB.submittedAt)
  })

  it('moves the submit gate with the service clock', async () => {
    const limitsForm = createForm({
      status: 'published',
      publishedVersionId: VERSION_ID,
      limits: {
        opensAt: '2026-05-01T00:00:00.000Z',
        closesAt: '2026-06-01T00:00:00.000Z',
        totalCap: null,
        perIdentityLimit: null,
      },
    })
    const closedHarness = buildSubmitHarnessWithForm(limitsForm, '2026-04-30T00:00:00.000Z')
    const openHarness = buildSubmitHarnessWithForm(limitsForm, '2026-05-15T00:00:00.000Z')

    await expect(closedHarness.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_closed',
    })
    await expect(openHarness.service.submit(ownerActor, submitInput())).resolves.toMatchObject({
      status: 'pending',
    })
    expect(closedHarness.submissions.list()).toEqual([])
  })

  it('derives session consumedAt and expiry from the session clock', async () => {
    const tokens = new InMemoryTokenRepository()
    const sessions = new InMemorySessionRepository()
    const contacts = new InMemoryContactRepository([ownerContact])
    const events = new InMemoryEventRepository([eventFixture])
    const forms = new InMemoryFormRepository([
      createForm({ status: 'published', publishedVersionId: VERSION_ID }),
    ])
    const messages = new InMemoryCapturedMessageRepository()
    const unitOfWork = new InMemorySessionUnitOfWork({ tokens, sessions, messages, contacts })
    const hasher = {
      async hash(token: string): Promise<string> {
        return `hash:${token}`
      },
    }
    const generator = {
      async generate(): Promise<string> {
        return 'token-1'
      },
    }
    const service = new SessionService(
      tokens,
      sessions,
      contacts,
      events,
      forms,
      hasher,
      generator,
      unitOfWork,
      { now: () => CLOCK_A },
    )
    await tokens.save(createSubmitterToken())

    const issued = await service.redeemSubmitterToken('token-1', 60_000)

    expect(issued.expiresAt).toBe('2026-05-20T09:01:00.000Z')
    expect(tokens.list()[0]?.consumedAt).toBe(CLOCK_A)
    expect(sessions.list()[0]?.createdAt).toBe(CLOCK_A)
  })

  it('derives publish and draft stamps from their service clocks', async () => {
    const events = new InMemoryEventRepository([eventFixture])
    const forms = new InMemoryFormRepository([createForm()])
    const versions = new InMemoryFormVersionRepository()
    const content = new InMemoryFormContentRepository()
    const taxonomies = new InMemoryTaxonomyRepository([[EVENT_ID, [createTaxonomyItem()]]])
    const builderUnitOfWork = new InMemoryFormBuilderUnitOfWork({
      versions,
      content,
      forms,
    })
    const builder = new FormBuilderService(
      events,
      forms,
      versions,
      content,
      taxonomies,
      builderUnitOfWork,
      { now: () => CLOCK_B },
    )
    const drafts = new InMemoryDraftRepository([createDraft()])
    const draftService = new DraftService(drafts, forms, versions, { now: () => CLOCK_A })

    const draft = await builder.updateDraft(organizerActor, EVENT_ID, FORM_ID, {
      pages: createContent().pages,
      elements: createContent().elements,
      conditionRules: createContent().conditionRules,
      routingRules: createContent().routingRules,
    })
    const published = await builder.publish(organizerActor, EVENT_ID, FORM_ID)
    const savedDraft = await draftService.save(ownerActor, {
      id: DRAFT_ID,
      formId: FORM_ID,
      formVersionId: draft.versionId,
      title: 'Resumed',
      answers: {},
    })

    expect(draft.updatedAt).toBe(CLOCK_B)
    expect(published.publishedAt).toBe(CLOCK_B)
    expect(published.updatedAt).toBe(CLOCK_B)
    expect(savedDraft.updatedAt).toBe(CLOCK_A)
  })
})

function buildSubmitHarnessWithForm(form: ReturnType<typeof createForm>, clockNow: string) {
  const version = createVersion({
    status: 'published',
    contentHash: 'a'.repeat(64),
    publishedAt: NOW,
  })
  const drafts = new InMemoryDraftRepository([createDraft()])
  const versions = new InMemoryFormVersionRepository([version])
  const forms = new InMemoryFormRepository([form])
  const content = new InMemoryFormContentRepository([[EVENT_ID, VERSION_ID, createContent()]])
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
  const service = new SubmitService(
    drafts,
    submissions,
    contacts,
    forms,
    versions,
    content,
    unitOfWork,
    { now: () => clockNow },
  )
  return { service, submissions }
}
