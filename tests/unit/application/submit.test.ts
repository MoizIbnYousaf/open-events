import { describe, expect, it } from 'vitest'

import { SubmitService, type SubmitInput } from '../../../src/application'
import { MAX_CO_SPEAKERS, type FormLimits, type ProposalSubmission } from '../../../src/domain'
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
  createVersion,
  eventFixture,
  crossEventActor,
  foreignActor,
  openLimits,
  ownerActor,
  ownerContact,
} from '../helpers/fixtures'
import {
  InMemoryCapturedMessageRepository,
  InMemoryConfirmationRepository,
  InMemoryContactRepository,
  InMemoryEventRepository,
  InMemoryDraftRepository,
  InMemoryProgrammeRepository,
  InMemoryFormContentRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemorySubmissionRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySubmitUnitOfWork } from '../helpers/in-memory-unit-of-work'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

function buildHarness(
  options: {
    limits?: FormLimits
    formStatus?: 'draft' | 'published'
    publishedVersionId?: string | null
    clockNow?: string
    programme?: InMemoryProgrammeRepository
    events?: InMemoryEventRepository
  } = {},
) {
  const form = createForm({
    status: options.formStatus ?? 'published',
    publishedVersionId:
      options.publishedVersionId === undefined ? VERSION_ID : options.publishedVersionId,
    limits: options.limits ?? openLimits,
  })
  const version = createVersion({
    status: options.formStatus === 'draft' ? 'draft' : 'published',
    contentHash: options.formStatus === 'draft' ? null : 'a'.repeat(64),
    publishedAt: options.formStatus === 'draft' ? null : NOW,
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
  const service = new SubmitService(
    drafts,
    submissions,
    contacts,
    forms,
    versions,
    formContent,
    unitOfWork,
    { now: () => options.clockNow ?? FIXED_NOW },
    options.programme ?? null,
    options.events ?? null,
  )
  return { service, drafts, submissions, contacts, confirmations, messages, unitOfWork, form }
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

describe('SubmitService happy path', () => {
  it('persists a pending submission, contributors, confirmation, and message, then deletes the draft', async () => {
    const { service, drafts, submissions, confirmations, messages } = buildHarness()

    const detail = await service.submit(
      ownerActor,
      submitInput({ coSpeakers: [{ name: 'Co Speaker', email: 'co@example.test' }] }),
    )

    expect(detail.status).toBe('pending')
    expect(detail.eventId).toBe(EVENT_ID)
    expect(detail.formSlug).toBe('cfp')
    expect(detail.version).toBe(1)
    expect(detail.routing).toEqual({ actionKind: 'assign_track', actionTarget: 'workshop' })
    expect(detail.contributors.map((contributor) => contributor.role)).toEqual([
      'primary',
      'co-speaker',
    ])
    expect(submissions.list()).toHaveLength(1)
    expect(submissions.list()[0]?.submittedAt).toBe(FIXED_NOW)
    expect(submissions.list()[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(drafts.list()).toEqual([])
    expect(await confirmations.findBySubmissionId(detail.id)).not.toBeNull()
    expect(messages.list()).toHaveLength(1)
    expect(messages.list()[0]?.toEmail).toBe('speaker-a@example.test')
    expect(messages.list()[0]?.subject).toBe('Your submission was received')
    expect(messages.list()[0]?.body).toContain('Hands-on workshop proposal')
  })

  it('uses the organizer confirmation template when one is stored', async () => {
    const programme = new InMemoryProgrammeRepository()
    await programme.saveEmailTemplate(
      EVENT_ID,
      'confirmation',
      '{{eventName}}: got "{{title}}"',
      'Ref {{submissionId}}',
    )
    const events = new InMemoryEventRepository([eventFixture])
    const { service, messages } = buildHarness({ programme, events })
    const detail = await service.submit(ownerActor, submitInput())
    expect(messages.list()[0]?.subject).toBe('DemoConf 2026: got "Hands-on workshop proposal"')
    expect(messages.list()[0]?.body).toBe(`Ref ${detail.id}`)
  })

  it('returns null routing when no rule matches', async () => {
    const { service } = buildHarness()

    const detail = await service.submit(
      ownerActor,
      submitInput({
        answers: {
          title: 'Hands-on workshop proposal',
          format: 'talk',
          'contact-email': 'speaker-a@example.test',
          attendees: 25,
          topics: ['ai'],
        },
      }),
    )

    expect(detail.routing).toBeNull()
  })
})

describe('SubmitService idempotency', () => {
  it('returns the existing submission for a retried originDraftId without side effects', async () => {
    const { service, drafts, submissions, messages } = buildHarness()

    const first = await service.submit(ownerActor, submitInput())
    const retry = await service.submit(ownerActor, submitInput())

    expect(retry.id).toBe(first.id)
    expect(submissions.list()).toHaveLength(1)
    expect(drafts.list()).toEqual([])
    expect(messages.list()).toHaveLength(1)
  })
})

describe('SubmitService gates', () => {
  it('rejects before the CFP opens and after it closes', async () => {
    const limits: FormLimits = {
      opensAt: '2026-05-01T00:00:00.000Z',
      closesAt: '2026-06-01T00:00:00.000Z',
      totalCap: null,
      perIdentityLimit: null,
    }
    const early = buildHarness({ limits, clockNow: '2026-04-30T00:00:00.000Z' })
    const late = buildHarness({ limits, clockNow: '2026-06-01T00:00:00.000Z' })

    await expect(early.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_closed',
    })
    await expect(late.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_closed',
    })
  })

  it('rejects when the total cap is reached', async () => {
    const { service, submissions } = buildHarness({ limits: { ...openLimits, totalCap: 1 } })
    await submissions.save(
      createSubmission({ id: 'submission-existing', originDraftId: 'draft-existing' }),
    )

    await expect(service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_capped',
    })
  })

  it('rejects when the per-identity limit is reached', async () => {
    const { service, submissions } = buildHarness({
      limits: { ...openLimits, perIdentityLimit: 1 },
    })
    await submissions.save(
      createSubmission({ id: 'submission-existing', originDraftId: 'draft-existing' }),
    )

    await expect(service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'identity_limit_reached',
    })
  })

  it('does not apply caps when they are null', async () => {
    const { service, submissions } = buildHarness({ limits: openLimits })
    await submissions.save(
      createSubmission({ id: 'submission-existing', originDraftId: 'draft-existing' }),
    )

    await expect(service.submit(ownerActor, submitInput())).resolves.toMatchObject({
      status: 'pending',
    })
  })

  it('rejects submits against an unpublished form or a stale version binding', async () => {
    const unpublished = buildHarness({ formStatus: 'draft', publishedVersionId: null })
    const staleBinding = buildHarness({ publishedVersionId: 'version-other' })

    await expect(unpublished.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_closed',
    })
    await expect(staleBinding.service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'cfp_closed',
    })
  })
})

describe('SubmitService actor scope', () => {
  it('rejects a missing draft', async () => {
    const { service, drafts } = buildHarness()
    await drafts.deleteById(EVENT_ID, DRAFT_ID)

    await expect(service.submit(ownerActor, submitInput())).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('rejects drafts owned by another identity or event', async () => {
    const { service } = buildHarness()

    await expect(service.submit(foreignActor, submitInput())).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(service.submit(crossEventActor, submitInput())).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('rejects a draft bound to a different form version', async () => {
    const { service } = buildHarness()

    await expect(
      service.submit(ownerActor, submitInput({ formVersionId: 'version-other' })),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('rejects an empty title', async () => {
    const { service } = buildHarness()

    await expect(service.submit(ownerActor, submitInput({ title: '   ' }))).rejects.toMatchObject({
      code: 'validation_failed',
    })
  })
})

describe('SubmitService server-side answer re-evaluation', () => {
  it('rejects unknown fields, hidden fields, and missing required answers', async () => {
    const { service } = buildHarness()

    const unknown = await service
      .submit(ownerActor, submitInput({ answers: { hacked: 'value' } }))
      .catch((error: unknown) => error)
    expect(unknown).toMatchObject({ code: 'validation_failed' })
    expect(
      (unknown as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('unknown_field')

    const hidden = await service
      .submit(
        ownerActor,
        submitInput({
          answers: { ...submitInput().answers, format: 'talk', workshop: 'sneaky' },
        }),
      )
      .catch((error: unknown) => error)
    expect((hidden as { issues: readonly { code: string }[] }).issues.map((i) => i.code)).toContain(
      'hidden_field_submitted',
    )

    const missing = await service
      .submit(ownerActor, submitInput({ answers: { ...submitInput().answers, title: '' } }))
      .catch((error: unknown) => error)
    expect(
      (missing as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('missing_required')
  })

  it('rejects invalid emails, options, and lengths', async () => {
    const { service } = buildHarness()

    const badEmail = await service
      .submit(
        ownerActor,
        submitInput({ answers: { ...submitInput().answers, 'contact-email': 'nope' } }),
      )
      .catch((error: unknown) => error)
    const badOption = await service
      .submit(ownerActor, submitInput({ answers: { ...submitInput().answers, format: 'keynote' } }))
      .catch((error: unknown) => error)
    const tooLong = await service
      .submit(
        ownerActor,
        submitInput({ answers: { ...submitInput().answers, workshop: 'x'.repeat(501) } }),
      )
      .catch((error: unknown) => error)

    expect(
      (badEmail as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('invalid_type')
    expect(
      (badOption as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('invalid_option')
    expect(
      (tooLong as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('exceeds_max_length')
  })
})

describe('SubmitService co-speakers and atomic contacts', () => {
  it(`accepts exactly MAX_CO_SPEAKERS (${MAX_CO_SPEAKERS}) co-speakers`, async () => {
    const { service } = buildHarness()
    const coSpeakers = Array.from({ length: MAX_CO_SPEAKERS }, (_, index) => ({
      name: `Co ${index}`,
      email: `co-${index}@example.test`,
    }))

    const detail = await service.submit(ownerActor, submitInput({ coSpeakers }))

    expect(detail.status).toBe('pending')
    expect(detail.contributors).toHaveLength(MAX_CO_SPEAKERS + 1)
  })

  it(`rejects MAX_CO_SPEAKERS + 1 (${MAX_CO_SPEAKERS + 1}) co-speakers with zero writes`, async () => {
    const { service, contacts, submissions, confirmations, messages, drafts } = buildHarness()
    const tooMany = Array.from({ length: MAX_CO_SPEAKERS + 1 }, (_, index) => ({
      name: `Co ${index}`,
      email: `co-${index}@example.test`,
    }))

    await expect(
      service.submit(ownerActor, submitInput({ coSpeakers: tooMany })),
    ).rejects.toMatchObject({ code: 'validation_failed' })

    expect(contacts.list()).toHaveLength(1)
    expect(submissions.list()).toEqual([])
    expect(confirmations.list()).toEqual([])
    expect(messages.list()).toEqual([])
    expect(drafts.list()).toHaveLength(1)
  })

  it('pins MAX_CO_SPEAKERS to a positive integer', () => {
    expect(MAX_CO_SPEAKERS).toBe(10)
    expect(Number.isInteger(MAX_CO_SPEAKERS)).toBe(true)
    expect(MAX_CO_SPEAKERS).toBeGreaterThan(0)
  })

  it('upserts a normalized co-speaker contact inside the unit of work', async () => {
    const { service, contacts, submissions } = buildHarness()

    const detail = await service.submit(
      ownerActor,
      submitInput({
        coSpeakers: [{ name: 'Co Speaker', email: '  Co.Speaker@Example.TEST ' }],
      }),
    )

    expect(detail.contributors).toHaveLength(2)
    expect(detail.contributors[1]).toMatchObject({
      role: 'co-speaker',
      position: 1,
      email: 'co.speaker@example.test',
    })
    expect(await contacts.findByEmail('co.speaker@example.test')).not.toBeNull()
    expect(contacts.list()).toHaveLength(2)
    const contributors = await submissions.listContributorsBySubmission(EVENT_ID, detail.id)
    expect(contributors.map((contributor) => contributor.role)).toEqual(['primary', 'co-speaker'])
  })

  it('rejects duplicate or invalid co-speaker emails', async () => {
    const duplicateOwner = buildHarness()
    const duplicateCo = buildHarness()
    const invalid = buildHarness()

    await expect(
      duplicateOwner.service.submit(
        ownerActor,
        submitInput({
          coSpeakers: [{ name: 'Owner Again', email: 'Speaker-A@Example.TEST' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(
      duplicateCo.service.submit(
        ownerActor,
        submitInput({
          coSpeakers: [
            { name: 'A', email: 'co-a@example.test' },
            { name: 'B', email: 'CO-A@example.test' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(
      invalid.service.submit(
        ownerActor,
        submitInput({ coSpeakers: [{ name: 'Bad', email: 'not-an-email' }] }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('creates no contacts when the submit is rejected', async () => {
    const capped = buildHarness({ limits: { ...openLimits, totalCap: 1 } })
    await capped.submissions.save(
      createSubmission({ id: 'submission-existing', originDraftId: 'draft-existing' }),
    )
    const invalidAnswers = buildHarness()

    await expect(
      capped.service.submit(
        ownerActor,
        submitInput({ coSpeakers: [{ name: 'Co', email: 'co@example.test' }] }),
      ),
    ).rejects.toMatchObject({ code: 'cfp_capped' })
    expect(capped.contacts.list()).toHaveLength(1)

    await expect(
      invalidAnswers.service.submit(
        ownerActor,
        submitInput({
          coSpeakers: [{ name: 'Co', email: 'co@example.test' }],
          answers: { hacked: 'value' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    expect(invalidAnswers.contacts.list()).toHaveLength(1)
  })
})

describe('SubmitService listOwn', () => {
  async function seedOwned(
    submissions: InMemorySubmissionRepository,
    rows: readonly {
      readonly id: string
      readonly submittedAt: string
      readonly overrides?: Partial<ProposalSubmission>
    }[],
  ): Promise<void> {
    for (const row of rows) {
      const submission = createSubmission({
        id: row.id,
        originDraftId: `draft-${row.id}`,
        submittedAt: row.submittedAt,
        ...row.overrides,
      })
      await submissions.save(submission)
      await submissions.saveContributors(submission.eventId, submission.id, [
        {
          submissionId: submission.id,
          eventId: submission.eventId,
          contactId: submission.ownerContactId,
          role: 'primary',
          position: 0,
        },
      ])
    }
  }

  it('orders the owner submissions newest first with an ascending id tie-break', async () => {
    const { service, submissions } = buildHarness()
    await seedOwned(submissions, [
      { id: 'submission-b-tie', submittedAt: '2026-03-01T00:00:00.000Z' },
      { id: 'submission-oldest', submittedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'submission-a-tie', submittedAt: '2026-03-01T00:00:00.000Z' },
      { id: 'submission-middle', submittedAt: '2026-02-01T00:00:00.000Z' },
    ])

    const items = await service.listOwn(ownerActor)

    expect(items.map((item) => item.id)).toEqual([
      'submission-a-tie',
      'submission-b-tie',
      'submission-middle',
      'submission-oldest',
    ])
  })

  it('excludes other owners and other events, and keeps answers out of list items', async () => {
    const { service, submissions } = buildHarness()
    await seedOwned(submissions, [
      { id: 'submission-own', submittedAt: '2026-02-01T00:00:00.000Z' },
      {
        id: 'submission-foreign-owner',
        submittedAt: '2026-04-01T00:00:00.000Z',
        overrides: { ownerContactId: foreignActor.contactId },
      },
      {
        id: 'submission-other-event',
        submittedAt: '2026-05-01T00:00:00.000Z',
        overrides: { eventId: crossEventActor.eventId },
      },
    ])

    const items = await service.listOwn(ownerActor)

    expect(items.map((item) => item.id)).toEqual(['submission-own'])
    expect(items[0]).not.toHaveProperty('answers')
    expect(items[0]?.primarySpeaker.contactId).toBe(ownerContact.id)
  })
})
