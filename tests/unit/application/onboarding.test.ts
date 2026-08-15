import { beforeEach, describe, expect, it } from 'vitest'

import { ApplicationError, OnboardingService } from '../../../src/application'
import type { Clock } from '../../../src/application'
import { SPEAKER_TASK_KINDS } from '../../../src/domain'
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
  InMemoryProgrammeRepository,
  InMemorySubmissionRepository,
  InMemoryTaxonomyRepository,
} from '../helpers/in-memory-repositories'
import {
  InMemoryAcceptUnitOfWork,
  InMemorySpeakerTaskRepository,
  InMemoryUploadedFileRepository,
} from '../helpers/in-memory-onboarding'

const CO_SPEAKER_CONTACT_ID = 'contact-speaker-b'
const LATER = '2026-05-21T09:00:00.000Z'

const submission = createSubmission()
const otherEventSubmission = createSubmission({
  id: 'submission-other',
  eventId: 'event-other',
  originDraftId: 'draft-other',
})

let now: string
let tasks: InMemorySpeakerTaskRepository
let submissions: InMemorySubmissionRepository
let events: InMemoryEventRepository
let acceptUnitOfWork: InMemoryAcceptUnitOfWork
let service: OnboardingService

const clock: Clock = { now: () => now }

/** Rebuilds the service against a specific event configuration. */
function buildService(event = eventFixture): OnboardingService {
  events = new InMemoryEventRepository([event])
  acceptUnitOfWork = new InMemoryAcceptUnitOfWork(
    tasks,
    [submission.id, otherEventSubmission.id],
    [OWNER_CONTACT_ID, CO_SPEAKER_CONTACT_ID],
  )
  return new OnboardingService(
    submissions,
    events,
    tasks,
    acceptUnitOfWork,
    clock,
    new InMemoryFormRepository(),
    new InMemoryFormVersionRepository(),
    new InMemoryFormContentRepository(),
    new InMemoryContactRepository([
      { ...ownerContact, bio: 'Seeded bio' },
      {
        id: CO_SPEAKER_CONTACT_ID,
        email: 'speaker-b@example.test',
        name: 'Speaker B',
        createdAt: '2026-05-20T09:00:00.000Z',
        bio: 'Seeded co-speaker bio',
      },
    ]),
    seededUploads(),
    new InMemoryTaxonomyRepository(),
  )
}

beforeEach(async () => {
  now = FIXED_NOW
  tasks = new InMemorySpeakerTaskRepository()
  submissions = new InMemorySubmissionRepository(new InMemoryFormVersionRepository(), [
    submission,
    otherEventSubmission,
  ])
  await submissions.saveContributors(EVENT_ID, submission.id, [
    {
      submissionId: submission.id,
      eventId: EVENT_ID,
      contactId: OWNER_CONTACT_ID,
      role: 'primary',
      position: 0,
    },
    {
      submissionId: submission.id,
      eventId: EVENT_ID,
      contactId: CO_SPEAKER_CONTACT_ID,
      role: 'co-speaker',
      position: 1,
    },
  ])
  service = buildService()
})

function seededUploads(): InMemoryUploadedFileRepository {
  const uploads = new InMemoryUploadedFileRepository()
  void uploads.upsert({
    id: 'upload-seeded-b',
    eventId: 'event-demo-conf',
    ownerContactId: 'contact-speaker-b',
    kind: 'headshot',
    storageKey: 'events/event-demo-conf/contacts/contact-speaker-b/headshot/upload-seeded-b',
    contentType: 'image/png',
    sizeBytes: 10,
    createdAt: '2026-05-20T09:00:00.000Z',
    updatedAt: '2026-05-20T09:00:00.000Z',
  })
  void uploads.upsert({
    id: 'upload-seeded',
    eventId: 'event-demo-conf',
    ownerContactId: 'contact-speaker-a',
    kind: 'headshot',
    storageKey: 'events/event-demo-conf/contacts/contact-speaker-a/headshot/upload-seeded',
    contentType: 'image/png',
    sizeBytes: 10,
    createdAt: '2026-05-20T09:00:00.000Z',
    updatedAt: '2026-05-20T09:00:00.000Z',
  })
  return uploads
}

describe('OnboardingService.accept', () => {
  it('creates one task per checklist kind for every contributor', async () => {
    const result = await service.accept(organizerActor, EVENT_ID, submission.id)

    expect(result.submissionId).toBe(submission.id)
    expect(result.acceptedAt).toBe(FIXED_NOW)
    expect(result.alreadyAccepted).toBe(false)
    expect(result.tasks).toHaveLength(SPEAKER_TASK_KINDS.length * 2)
    expect(new Set(result.tasks.map((task) => task.contactId))).toEqual(
      new Set([OWNER_CONTACT_ID, CO_SPEAKER_CONTACT_ID]),
    )
    expect(result.tasks.every((task) => task.status === 'pending')).toBe(true)
    expect(result.tasks.every((task) => task.completedAt === null)).toBe(true)
    expect(new Set(result.tasks.map((task) => task.id)).size).toBe(result.tasks.length)
  })

  it('is idempotent: a repeated accept creates no second checklist', async () => {
    const first = await service.accept(organizerActor, EVENT_ID, submission.id)
    now = LATER
    const second = await service.accept(organizerActor, EVENT_ID, submission.id)

    expect(second.alreadyAccepted).toBe(true)
    expect(second.acceptedAt).toBe(FIXED_NOW)
    expect(second.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id))
    expect(await tasks.listByEvent(EVENT_ID)).toHaveLength(first.tasks.length)
  })

  it('rejects an unknown submission with not_found', async () => {
    await expect(
      service.accept(organizerActor, EVENT_ID, 'submission-missing'),
    ).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(
      service.accept(organizerActor, EVENT_ID, 'submission-missing'),
    ).rejects.toBeInstanceOf(ApplicationError)
  })

  // The accepted proposal has to become a placeable session in the same batch,
  // otherwise nothing the organizer can drag ever exists.
  it('materialises one unassigned agenda session carrying every contributor', async () => {
    await service.accept(organizerActor, EVENT_ID, submission.id)

    const sessions = acceptUnitOfWork.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      eventId: EVENT_ID,
      submissionId: submission.id,
      day: '2026-05-13',
      start: '2026-05-13T08:00:00.000Z',
    })
    expect(sessions[0]?.end).toBe('2026-05-13T09:00:00.000Z')
    expect(new Set(sessions[0]?.speakerContactIds)).toEqual(
      new Set([OWNER_CONTACT_ID, CO_SPEAKER_CONTACT_ID]),
    )
  })

  it('places the session on the acceptance day when the event has no dates yet', async () => {
    service = buildService({ ...eventFixture, dates: null })

    await service.accept(organizerActor, EVENT_ID, submission.id)

    const session = acceptUnitOfWork.listSessions()[0]
    expect(session?.day).toBe(FIXED_NOW.slice(0, 10))
    expect(session?.start).toBe(FIXED_NOW)
  })

  it('creates no second agenda session on a repeated accept', async () => {
    await service.accept(organizerActor, EVENT_ID, submission.id)
    now = LATER
    await service.accept(organizerActor, EVENT_ID, submission.id)

    expect(acceptUnitOfWork.listSessions()).toHaveLength(1)
  })
})

describe('OnboardingService task list and completion', () => {
  beforeEach(async () => {
    await service.accept(organizerActor, EVENT_ID, submission.id)
  })

  it('lists only the calling speaker own tasks', async () => {
    const owner = await service.listTasks(createSubmitterActor())
    const coSpeaker = await service.listTasks(
      createSubmitterActor({ contactId: CO_SPEAKER_CONTACT_ID }),
    )

    expect(owner).toHaveLength(SPEAKER_TASK_KINDS.length)
    expect(owner.every((task) => task.contactId === OWNER_CONTACT_ID)).toBe(true)
    expect(owner.every((task) => task.submissionTitle === submission.title)).toBe(true)
    expect(coSpeaker.every((task) => task.contactId === CO_SPEAKER_CONTACT_ID)).toBe(true)
  })

  it('returns an empty list for a speaker of another event', async () => {
    expect(await service.listTasks(createSubmitterActor({ eventId: 'event-other' }))).toEqual([])
  })

  it('completes an own task once and stays idempotent', async () => {
    const actor = createSubmitterActor()
    const [first] = await service.listTasks(actor)
    if (first === undefined) throw new Error('expected a seeded task')

    now = LATER
    const completed = await service.completeTask(actor, first.id)
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).toBe(LATER)

    now = '2026-05-22T09:00:00.000Z'
    const again = await service.completeTask(actor, first.id)
    expect(again.completedAt).toBe(LATER)
  })

  it('denies completing another speaker task with a safe not_found', async () => {
    const [ownerTask] = await service.listTasks(createSubmitterActor())
    if (ownerTask === undefined) throw new Error('expected a seeded task')

    await expect(
      service.completeTask(
        createSubmitterActor({ contactId: CO_SPEAKER_CONTACT_ID }),
        ownerTask.id,
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      service.completeTask(createSubmitterActor({ eventId: 'event-other' }), ownerTask.id),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('OnboardingService.readiness', () => {
  it('reports zeroes before any acceptance', async () => {
    expect(await service.readiness(organizerActor, EVENT_ID)).toEqual({
      eventId: EVENT_ID,
      acceptedSubmissions: 0,
      totalTasks: 0,
      completedTasks: 0,
      percentComplete: 100,
      submissions: [],
    })
  })

  it('aggregates completion across the accepted checklists', async () => {
    await service.accept(organizerActor, EVENT_ID, submission.id)
    const actor = createSubmitterActor()
    const [first] = await service.listTasks(actor)
    if (first === undefined) throw new Error('expected a seeded task')
    now = LATER
    await service.completeTask(actor, first.id)

    const readiness = await service.readiness(organizerActor, EVENT_ID)
    expect(readiness.acceptedSubmissions).toBe(1)
    expect(readiness.totalTasks).toBe(SPEAKER_TASK_KINDS.length * 2)
    expect(readiness.completedTasks).toBe(1)
    expect(readiness.percentComplete).toBe(17)
    expect(readiness.submissions).toEqual([
      {
        submissionId: submission.id,
        title: submission.title,
        totalTasks: SPEAKER_TASK_KINDS.length * 2,
        completedTasks: 1,
        percentComplete: 17,
        ready: false,
      },
    ])
  })

  it('marks a submission ready once every task is completed', async () => {
    await service.accept(organizerActor, EVENT_ID, submission.id)
    for (const contactId of [OWNER_CONTACT_ID, CO_SPEAKER_CONTACT_ID]) {
      const actor = createSubmitterActor({ contactId })
      for (const task of await service.listTasks(actor)) {
        await service.completeTask(actor, task.id)
      }
    }

    const readiness = await service.readiness(organizerActor, EVENT_ID)
    expect(readiness.percentComplete).toBe(100)
    expect(readiness.submissions[0]?.ready).toBe(true)
  })

  it('does not call a session Ready while a file request is still pending', async () => {
    const programme = new InMemoryProgrammeRepository()
    await programme.saveAssignment({
      id: 'assign-1',
      eventId: EVENT_ID,
      title: 'Upload slides',
      dueAt: null,
      kind: 'file_request',
      instructions: '',
      createdAt: now,
    })
    await programme.setAssignees('assign-1', [
      {
        assignmentId: 'assign-1',
        contactId: OWNER_CONTACT_ID,
        status: 'pending',
        completedAt: null,
      },
    ])
    service = new OnboardingService(
      submissions,
      events,
      tasks,
      acceptUnitOfWork,
      clock,
      new InMemoryFormRepository(),
      new InMemoryFormVersionRepository(),
      new InMemoryFormContentRepository(),
      new InMemoryContactRepository([
        { ...ownerContact, bio: 'Seeded bio' },
        {
          id: CO_SPEAKER_CONTACT_ID,
          email: 'speaker-b@example.test',
          name: 'Speaker B',
          createdAt: '2026-05-20T09:00:00.000Z',
          bio: 'Seeded co-speaker bio',
        },
      ]),
      seededUploads(),
      new InMemoryTaxonomyRepository(),
      programme,
    )
    await service.accept(organizerActor, EVENT_ID, submission.id)
    for (const contactId of [OWNER_CONTACT_ID, CO_SPEAKER_CONTACT_ID]) {
      const actor = createSubmitterActor({ contactId })
      for (const task of await service.listTasks(actor)) {
        await service.completeTask(actor, task.id)
      }
    }
    const readiness = await service.readiness(organizerActor, EVENT_ID)
    expect(readiness.submissions[0]?.ready).toBe(false)
    expect(readiness.completedTasks).toBeLessThan(readiness.totalTasks)
  })
})

// The speaker's own acceptance state. proposal_submissions.status is pinned to
// 'pending' by migration 0002 and the acceptance row IS the accepted state, so
// this actor-scoped read is what lets the portal show it. It never reveals
// another speaker's submissions and never leaves the actor's own event.
describe('OnboardingService.listAcceptedOwnSubmissionIds', () => {
  it('is empty before any acceptance', async () => {
    expect(await service.listAcceptedOwnSubmissionIds(createSubmitterActor())).toEqual([])
  })

  it('returns only the calling speaker own accepted submissions', async () => {
    await service.accept(organizerActor, EVENT_ID, submission.id)

    expect(await service.listAcceptedOwnSubmissionIds(createSubmitterActor())).toEqual([
      submission.id,
    ])
  })

  it('never reports another speaker submissions or another event', async () => {
    await service.accept(organizerActor, EVENT_ID, submission.id)

    expect(
      await service.listAcceptedOwnSubmissionIds(
        createSubmitterActor({ contactId: CO_SPEAKER_CONTACT_ID }),
      ),
    ).toEqual([])
    expect(
      await service.listAcceptedOwnSubmissionIds(createSubmitterActor({ eventId: 'event-other' })),
    ).toEqual([])
  })
})
