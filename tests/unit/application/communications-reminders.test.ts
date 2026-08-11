import { describe, expect, it } from 'vitest'

import { ApplicationError, CommunicationsService } from '../../../src/application'
import type { Contact, Event } from '../../../src/domain'
import {
  EVENT_ID,
  OWNER_CONTACT_ID,
  createSubmission,
  createVersion,
  eventFixture,
  organizerActor,
  ownerContact,
  FIXED_NOW,
} from '../helpers/fixtures'
import {
  InMemoryCapturedMessageRepository,
  InMemoryContactRepository,
  InMemoryEventRepository,
  InMemoryFormVersionRepository,
  InMemorySubmissionRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySpeakerTaskRepository } from '../helpers/in-memory-onboarding'

// O2 audience + reminder contract (REQ-010): previews name the resolved
// accepted-speaker audience — owner plus actual submission contributors,
// case-insensitively deduped — before anything is queued; acceptance and
// reminder queue one immutable row per recipient, idempotently per
// kind/recipient; history carries the kind. No unrelated contact ever
// appears.

const SUBMISSION_ID = 'submission-1'

const ACCEPTANCE = {
  eventId: EVENT_ID,
  submissionId: SUBMISSION_ID,
  acceptedAt: '2026-05-19T09:00:00.000Z',
}

const CO_SPEAKER: Contact = {
  id: 'contact-speaker-b',
  email: 'Speaker-B@Example.Test',
  name: 'Speaker B',
  createdAt: FIXED_NOW,
}

const DUPLICATE_OWNER: Contact = {
  id: 'contact-owner-duplicate',
  email: ownerContact.email.toUpperCase(),
  name: 'Owner Again',
  createdAt: FIXED_NOW,
}

const STRANGER: Contact = {
  id: 'contact-stranger',
  email: 'stranger@example.test',
  name: 'Stranger',
  createdAt: FIXED_NOW,
}

function buildHarness({
  accepted = true,
  event = eventFixture,
  contributors = [CO_SPEAKER, DUPLICATE_OWNER],
}: { accepted?: boolean; event?: Event; contributors?: readonly Contact[] } = {}) {
  const versions = new InMemoryFormVersionRepository([createVersion()])
  const submission = createSubmission()
  const submissions = new InMemorySubmissionRepository(versions, [submission])
  const events = new InMemoryEventRepository([event])
  const contacts = new InMemoryContactRepository([
    ownerContact,
    CO_SPEAKER,
    DUPLICATE_OWNER,
    STRANGER,
  ])
  const messages = new InMemoryCapturedMessageRepository()
  const tasks = new InMemorySpeakerTaskRepository([], accepted ? [ACCEPTANCE] : [])
  const service = new CommunicationsService(submissions, events, contacts, messages, tasks, {
    now: () => FIXED_NOW,
  })
  const seed = async () => {
    await submissions.saveContributors(EVENT_ID, SUBMISSION_ID, [
      {
        submissionId: SUBMISSION_ID,
        eventId: EVENT_ID,
        contactId: OWNER_CONTACT_ID,
        role: 'primary',
        position: 0,
      },
      ...contributors.map((contact, index) => ({
        submissionId: SUBMISSION_ID,
        eventId: EVENT_ID,
        contactId: contact.id,
        role: 'co-speaker' as const,
        position: index + 1,
      })),
    ])
  }
  return { service, messages, seed }
}

describe('audience resolution', () => {
  it('previews owner plus contributors with deduped normalized emails', async () => {
    const { service, seed } = buildHarness()
    await seed()
    const preview = await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(preview.audience.map((recipient) => recipient.email)).toEqual([
      'speaker-a@example.test',
      'speaker-b@example.test',
    ])
    expect(preview.audience.every((recipient) => recipient.alreadySent === false)).toBe(true)
  })

  it('never exposes an unrelated contact', async () => {
    const { service, seed } = buildHarness()
    await seed()
    const preview = await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(JSON.stringify(preview)).not.toContain('stranger@example.test')
  })

  it('reminder preview resolves the same audience', async () => {
    const { service, seed } = buildHarness()
    await seed()
    const preview = await service.previewReminder(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(preview.audience.map((recipient) => recipient.email)).toEqual([
      'speaker-a@example.test',
      'speaker-b@example.test',
    ])
  })
})

describe('queueing acceptance and reminder', () => {
  it('queues one acceptance row per deduped recipient', async () => {
    const { service, messages, seed } = buildHarness()
    await seed()
    const sent = await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(sent.map((message) => message.toEmail)).toEqual([
      'speaker-a@example.test',
      'speaker-b@example.test',
    ])
    expect(sent.every((message) => message.kind === 'acceptance')).toBe(true)
    expect(messages.list()).toHaveLength(2)
  })

  it('repeat acceptance returns the stored winners without new rows', async () => {
    const { service, messages, seed } = buildHarness()
    await seed()
    const first = await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    const second = await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(second).toEqual(first)
    expect(messages.list()).toHaveLength(2)
  })

  it('acceptance and reminder coexist and history reports both kinds', async () => {
    const { service, seed } = buildHarness()
    await seed()
    await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    const reminders = await service.queueReminder(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(reminders.every((message) => message.kind === 'reminder')).toBe(true)
    const history = await service.listHistory(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(history).toHaveLength(4)
    expect(new Set(history.map((message) => message.kind))).toEqual(
      new Set(['acceptance', 'reminder']),
    )
  })

  it('reminder subject is distinct from the acceptance subject', async () => {
    const { service, seed } = buildHarness()
    await seed()
    const acceptance = await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    const reminder = await service.previewReminder(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(reminder.subject).not.toBe(acceptance.subject)
    expect(reminder.body).not.toContain('{{')
  })

  it('refuses a reminder for a submission that was never accepted', async () => {
    const { service, seed } = buildHarness({ accepted: false })
    await seed()
    await expect(
      service.queueReminder(organizerActor, EVENT_ID, SUBMISSION_ID),
    ).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('marks per-recipient alreadySent in the preview after a send', async () => {
    const { service, seed } = buildHarness()
    await seed()
    await service.queueAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    const preview = await service.previewAcceptance(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(preview.alreadySent).toBe(true)
    expect(preview.audience.every((recipient) => recipient.alreadySent)).toBe(true)
    const reminderPreview = await service.previewReminder(organizerActor, EVENT_ID, SUBMISSION_ID)
    expect(reminderPreview.alreadySent).toBe(false)
  })

  it('throws not_found for an unknown submission', async () => {
    const { service } = buildHarness()
    await expect(
      service.previewReminder(organizerActor, EVENT_ID, 'submission-missing'),
    ).rejects.toBeInstanceOf(ApplicationError)
  })
})
