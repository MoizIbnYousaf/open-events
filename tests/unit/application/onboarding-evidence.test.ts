import { beforeEach, describe, expect, it } from 'vitest'

import { OnboardingService, ValidationFailedError } from '../../../src/application'
import type { Clock, UploadedFileRecord } from '../../../src/application'
import {
  EVENT_ID,
  FIXED_NOW,
  OWNER_CONTACT_ID,
  createSubmission,
  createSubmitterActor,
  eventFixture,
  organizerActor,
  ownerContact,
} from '../helpers/fixtures'
import {
  InMemoryContactRepository,
  InMemoryEventRepository,
  InMemoryFormContentRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemorySubmissionRepository,
} from '../helpers/in-memory-repositories'
import {
  InMemoryAcceptUnitOfWork,
  InMemorySpeakerTaskRepository,
  InMemoryUploadedFileRepository,
} from '../helpers/in-memory-onboarding'

// O3 P3: task completion is evidence-checked. submit_bio completes only when
// the speaker's persisted bio is non-empty; submit_headshot only when a
// stored headshot upload exists for the owning speaker/event;
// confirm_participation stays explicit self-attestation and every DTO labels
// its evidence kind honestly. Readiness derives from the same gates, so it
// cannot be made green by bare completion calls.

const submission = createSubmission()

let contacts: InMemoryContactRepository
let uploads: InMemoryUploadedFileRepository
let tasks: InMemorySpeakerTaskRepository
let service: OnboardingService

const clock: Clock = { now: () => FIXED_NOW }

function headshotRecord(): UploadedFileRecord {
  return {
    id: 'upload-1',
    eventId: EVENT_ID,
    ownerContactId: OWNER_CONTACT_ID,
    kind: 'headshot',
    storageKey: `events/${EVENT_ID}/contacts/${OWNER_CONTACT_ID}/headshot/upload-1`,
    contentType: 'image/png',
    sizeBytes: 100,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  }
}

beforeEach(async () => {
  tasks = new InMemorySpeakerTaskRepository()
  contacts = new InMemoryContactRepository([{ ...ownerContact, bio: null }])
  uploads = new InMemoryUploadedFileRepository()
  const submissions = new InMemorySubmissionRepository(new InMemoryFormVersionRepository(), [
    submission,
  ])
  await submissions.saveContributors(submission.eventId, submission.id, [
    {
      submissionId: submission.id,
      eventId: submission.eventId,
      contactId: OWNER_CONTACT_ID,
      role: 'primary',
      position: 0,
    },
  ])
  service = new OnboardingService(
    submissions,
    new InMemoryEventRepository([eventFixture]),
    tasks,
    new InMemoryAcceptUnitOfWork(tasks, [submission.id], [OWNER_CONTACT_ID]),
    clock,
    new InMemoryFormRepository(),
    new InMemoryFormVersionRepository(),
    new InMemoryFormContentRepository(),
    contacts,
    uploads,
  )
  await service.accept(organizerActor, EVENT_ID, submission.id)
})

async function taskOfKind(kind: string) {
  const list = await service.listTasks(createSubmitterActor())
  const task = list.find((item) => item.kind === kind)
  if (task === undefined) throw new Error(`no ${kind} task`)
  return task
}

describe('evidence labels', () => {
  it('labels each task with its honest evidence kind', async () => {
    const list = await service.listTasks(createSubmitterActor())
    const byKind = new Map(list.map((task) => [task.kind, task.evidence]))
    expect(byKind.get('confirm_participation')).toBe('self_attestation')
    expect(byKind.get('submit_bio')).toBe('bio')
    expect(byKind.get('submit_headshot')).toBe('headshot')
  })
})

describe('submit_bio gate', () => {
  it('refuses completion while the bio is empty and readiness stays blocked', async () => {
    const task = await taskOfKind('submit_bio')
    await expect(service.completeTask(createSubmitterActor(), task.id)).rejects.toBeInstanceOf(
      ValidationFailedError,
    )
    const readiness = await service.readiness(organizerActor, EVENT_ID)
    expect(readiness.completedTasks).toBe(0)
  })

  it('completes once a non-empty bio is persisted', async () => {
    await contacts.updateProfile(OWNER_CONTACT_ID, { name: 'Ada', bio: 'Real bio' })
    const task = await taskOfKind('submit_bio')
    const completed = await service.completeTask(createSubmitterActor(), task.id)
    expect(completed.status).toBe('completed')
    const readiness = await service.readiness(organizerActor, EVENT_ID)
    expect(readiness.completedTasks).toBe(1)
  })
})

describe('submit_headshot gate', () => {
  it('refuses completion with no stored headshot', async () => {
    const task = await taskOfKind('submit_headshot')
    await expect(service.completeTask(createSubmitterActor(), task.id)).rejects.toBeInstanceOf(
      ValidationFailedError,
    )
  })

  it('completes once the owning speaker has a stored headshot in this event', async () => {
    await uploads.upsert(headshotRecord())
    const task = await taskOfKind('submit_headshot')
    const completed = await service.completeTask(createSubmitterActor(), task.id)
    expect(completed.status).toBe('completed')
  })

  it('ignores an upload owned by another speaker', async () => {
    await uploads.upsert({ ...headshotRecord(), ownerContactId: 'contact-someone-else' })
    const task = await taskOfKind('submit_headshot')
    await expect(service.completeTask(createSubmitterActor(), task.id)).rejects.toBeInstanceOf(
      ValidationFailedError,
    )
  })
})

describe('confirm_participation stays explicit self-attestation', () => {
  it('completes via the bare call with no evidence', async () => {
    const task = await taskOfKind('confirm_participation')
    const completed = await service.completeTask(createSubmitterActor(), task.id)
    expect(completed.status).toBe('completed')
    expect(completed.evidence).toBe('self_attestation')
  })
})
