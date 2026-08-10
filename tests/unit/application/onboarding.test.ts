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
  organizerActor,
} from '../helpers/fixtures'
import {
  InMemoryFormVersionRepository,
  InMemorySubmissionRepository,
} from '../helpers/in-memory-repositories'
import {
  InMemoryAcceptUnitOfWork,
  InMemorySpeakerTaskRepository,
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
let service: OnboardingService

const clock: Clock = { now: () => now }

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
  service = new OnboardingService(
    submissions,
    tasks,
    new InMemoryAcceptUnitOfWork(
      tasks,
      [submission.id, otherEventSubmission.id],
      [OWNER_CONTACT_ID, CO_SPEAKER_CONTACT_ID],
    ),
    clock,
  )
})

describe('OnboardingService.accept', () => {
  it('creates one task per checklist kind for every contributor', async () => {
    const result = await service.accept(organizerActor, submission.id)

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
    const first = await service.accept(organizerActor, submission.id)
    now = LATER
    const second = await service.accept(organizerActor, submission.id)

    expect(second.alreadyAccepted).toBe(true)
    expect(second.acceptedAt).toBe(FIXED_NOW)
    expect(second.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id))
    expect(await tasks.listByEvent(EVENT_ID)).toHaveLength(first.tasks.length)
  })

  it('rejects an unknown submission with not_found', async () => {
    await expect(service.accept(organizerActor, 'submission-missing')).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(service.accept(organizerActor, 'submission-missing')).rejects.toBeInstanceOf(
      ApplicationError,
    )
  })
})

describe('OnboardingService task list and completion', () => {
  beforeEach(async () => {
    await service.accept(organizerActor, submission.id)
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
    await service.accept(organizerActor, submission.id)
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
    await service.accept(organizerActor, submission.id)
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
})
