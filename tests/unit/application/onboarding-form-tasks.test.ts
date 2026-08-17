import { beforeEach, describe, expect, it } from 'vitest'

import {
  ApplicationError,
  OnboardingService,
  ValidationFailedError,
} from '../../../src/application'
import type { Clock } from '../../../src/application'
import type { CfpForm, FormVersion, FormVersionContent, SpeakerTask } from '../../../src/domain'
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
  InMemoryTaxonomyRepository,
} from '../helpers/in-memory-repositories'
import {
  InMemoryAcceptUnitOfWork,
  InMemorySpeakerTaskRepository,
  InMemoryUploadedFileRepository,
} from '../helpers/in-memory-onboarding'

// O1 contract: an organizer assigns a published onboarding form to one
// accepted speaker as a form-backed task; the speaker completes it only with
// answers that validate against the pinned version; the response is persisted
// and readiness reflects only validated completion. No label-only fake forms.

const FORM_ID = 'form-onboarding-av'
const VERSION_ID = 'version-onboarding-av-1'
const OTHER_EVENT_FORM_ID = 'form-other-event'

const submission = createSubmission()

const onboardingForm: CfpForm = {
  id: FORM_ID,
  eventId: EVENT_ID,
  slug: 'av-requirements',
  status: 'published',
  purpose: 'public',
  publishedVersionId: VERSION_ID,
  limits: { opensAt: null, closesAt: null, totalCap: null, perIdentityLimit: null },
}

const draftOnlyForm: CfpForm = {
  ...onboardingForm,
  id: 'form-draft-only',
  slug: 'draft-only',
  status: 'draft',
  publishedVersionId: null,
}

const otherEventForm: CfpForm = {
  ...onboardingForm,
  id: OTHER_EVENT_FORM_ID,
  eventId: 'event-other',
  slug: 'other-event-form',
}

const publishedVersion: FormVersion = {
  id: VERSION_ID,
  eventId: EVENT_ID,
  formId: FORM_ID,
  version: 1,
  status: 'published',
  contentHash: 'hash-av-1',
  publishedAt: FIXED_NOW,
  updatedAt: FIXED_NOW,
}

const versionContent: FormVersionContent = {
  pages: [
    {
      id: 'page-av-1',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      position: 0,
      kind: 'info',
      title: 'AV requirements',
      content: '',
    },
  ],
  elements: [
    {
      id: 'element-av-needs',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      pageId: 'page-av-1',
      position: 0,
      kind: 'question',
      fieldKey: 'av_needs',
      label: 'What A/V setup do you need?',
      required: true,
      maxLength: 200,
      questionType: 'short_text',
      options: [],
      optionsSource: null,
    },
  ],
  conditionRules: [],
  routingRules: [],
}

let now: string
let tasks: InMemorySpeakerTaskRepository
let submissions: InMemorySubmissionRepository
let service: OnboardingService

const clock: Clock = { now: () => now }

function buildService(): OnboardingService {
  const events = new InMemoryEventRepository([eventFixture])
  const acceptUnitOfWork = new InMemoryAcceptUnitOfWork(tasks, [submission.id], [OWNER_CONTACT_ID])
  const forms = new InMemoryFormRepository([onboardingForm, draftOnlyForm, otherEventForm])
  const versions = new InMemoryFormVersionRepository([publishedVersion])
  const content = new InMemoryFormContentRepository([[EVENT_ID, VERSION_ID, versionContent]])
  return new OnboardingService(
    submissions,
    events,
    tasks,
    acceptUnitOfWork,
    clock,
    forms,
    versions,
    content,
    new InMemoryContactRepository([{ ...ownerContact, bio: 'Seeded bio' }]),
    seededUploads(),
    new InMemoryTaxonomyRepository(),
  )
}

beforeEach(async () => {
  now = FIXED_NOW
  tasks = new InMemorySpeakerTaskRepository()
  submissions = new InMemorySubmissionRepository(new InMemoryFormVersionRepository(), [submission])
  await submissions.saveContributors(submission.eventId, submission.id, [
    {
      submissionId: submission.id,
      eventId: submission.eventId,
      contactId: OWNER_CONTACT_ID,
      role: 'primary',
      position: 0,
    },
  ])
  service = buildService()
  await service.accept(organizerActor, EVENT_ID, submission.id)
})

async function assignedTask() {
  return service.assignFormTask(organizerActor, EVENT_ID, submission.id, {
    formId: FORM_ID,
    contactId: OWNER_CONTACT_ID,
  })
}

function seededUploads(): InMemoryUploadedFileRepository {
  const uploads = new InMemoryUploadedFileRepository()
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

describe('assignFormTask', () => {
  it('creates a pending form-backed task pinned to the published version', async () => {
    const task = await assignedTask()
    expect(task.kind).toBe('complete_form')
    expect(task.status).toBe('pending')
    expect(task.formId).toBe(FORM_ID)
    expect(task.formVersionId).toBe(VERSION_ID)
    expect(task.response).toBeNull()
    expect(task.contactId).toBe(OWNER_CONTACT_ID)
    expect(task.submissionId).toBe(submission.id)
  })

  it('is idempotent for the same submission, speaker, and form', async () => {
    const first = await assignedTask()
    const second = await assignedTask()
    expect(second.id).toBe(first.id)
    const list = await service.listTasks(createSubmitterActor())
    expect(list.filter((task) => task.kind === 'complete_form')).toHaveLength(1)
  })

  it('rejects a submission that is not accepted', async () => {
    const unaccepted = createSubmission({ id: 'submission-unaccepted', originDraftId: 'draft-x' })
    await submissions.save(unaccepted)
    await expect(
      service.assignFormTask(organizerActor, EVENT_ID, 'submission-unaccepted', {
        formId: FORM_ID,
        contactId: OWNER_CONTACT_ID,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  /**
   * The acceptance record outlives the rejection that follows it, so a gate
   * reading it alone still hands new onboarding work to a speaker the
   * programme has turned down. The task would then be filtered out of their
   * checklist by the decision-aware read, which is the worst of both: work
   * created for somebody who can never see or complete it.
   */
  it('refuses to assign new onboarding work to a rejected speaker', async () => {
    await submissions.recordDecision({
      id: 'decision-1',
      eventId: EVENT_ID,
      submissionId: submission.id,
      outcome: 'rejected',
      decidedBy: 'organizer',
      decidedAt: FIXED_NOW,
    })

    await expect(
      service.assignFormTask(organizerActor, EVENT_ID, submission.id, {
        formId: FORM_ID,
        contactId: OWNER_CONTACT_ID,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects a form without a published version', async () => {
    await expect(
      service.assignFormTask(organizerActor, EVENT_ID, submission.id, {
        formId: 'form-draft-only',
        contactId: OWNER_CONTACT_ID,
      }),
    ).rejects.toBeInstanceOf(ApplicationError)
  })

  it('rejects a form that belongs to another event', async () => {
    await expect(
      service.assignFormTask(organizerActor, EVENT_ID, submission.id, {
        formId: OTHER_EVENT_FORM_ID,
        contactId: OWNER_CONTACT_ID,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects a contact that is not a contributor on the submission', async () => {
    await expect(
      service.assignFormTask(organizerActor, EVENT_ID, submission.id, {
        formId: FORM_ID,
        contactId: 'contact-stranger',
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('completeTask with a form response', () => {
  /**
   * The checklist read already hides a rejected speaker's tasks, but hiding is
   * not refusing: the ids were handed out BEFORE the rejection and completion
   * is by id, so the work stayed reachable.
   *
   * The consequence is worse than a stale checklist. Completing any task makes
   * the verdict final (`#requireReversible`), so a rejected speaker could
   * complete one task and permanently strip the organizer of the ability to
   * change their mind in either direction — the speaker deciding the
   * programme's decisions. The task must be refused, not merely unlisted, and
   * with the same not-found every other miss answers.
   */
  it('refuses to complete a task once the proposal has been rejected', async () => {
    const task = await assignedTask()
    await submissions.recordDecision({
      id: 'decision-1',
      eventId: EVENT_ID,
      submissionId: submission.id,
      outcome: 'rejected',
      decidedBy: 'organizer',
      decidedAt: FIXED_NOW,
    })

    await expect(
      service.completeTask(createSubmitterActor(), task.id, { av_needs: 'A microphone' }),
    ).rejects.toMatchObject({ code: 'not_found' })

    // And it really is still pending underneath, not merely reported as such:
    // a refusal that wrote the completion anyway would still freeze the verdict.
    const stored = await tasks.findById(task.id)
    expect(stored?.status).toBe('pending')
  })

  it('fails without answers and leaves the task pending', async () => {
    const task = await assignedTask()
    await expect(service.completeTask(createSubmitterActor(), task.id)).rejects.toBeInstanceOf(
      ValidationFailedError,
    )
    const list = await service.listTasks(createSubmitterActor())
    expect(list.find((item) => item.id === task.id)?.status).toBe('pending')
  })

  it('fails when a required answer is missing and does not persist a response', async () => {
    const task = await assignedTask()
    await expect(
      service.completeTask(createSubmitterActor(), task.id, { av_needs: '' }),
    ).rejects.toBeInstanceOf(ValidationFailedError)
    const list = await service.listTasks(createSubmitterActor())
    const after = list.find((item) => item.id === task.id)
    expect(after?.status).toBe('pending')
    expect(after?.response).toBeNull()
  })

  it('rejects unknown fields against the pinned version', async () => {
    const task = await assignedTask()
    await expect(
      service.completeTask(createSubmitterActor(), task.id, {
        av_needs: 'Two mics',
        surprise: 'nope',
      }),
    ).rejects.toBeInstanceOf(ValidationFailedError)
  })

  it('persists validated answers and completes the task', async () => {
    const task = await assignedTask()
    const completed = await service.completeTask(createSubmitterActor(), task.id, {
      av_needs: 'Two mics and HDMI',
    })
    expect(completed.status).toBe('completed')
    expect(completed.response).toEqual({ av_needs: 'Two mics and HDMI' })
    expect(completed.completedAt).toBe(FIXED_NOW)
  })

  it('keeps the first response on a repeated completion', async () => {
    const task = await assignedTask()
    await service.completeTask(createSubmitterActor(), task.id, { av_needs: 'First answer' })
    now = '2026-05-21T09:00:00.000Z'
    const repeat = await service.completeTask(createSubmitterActor(), task.id, {
      av_needs: 'Second answer',
    })
    expect(repeat.response).toEqual({ av_needs: 'First answer' })
    expect(repeat.completedAt).toBe(FIXED_NOW)
  })

  it('still completes checklist tasks without any answers', async () => {
    const list = await service.listTasks(createSubmitterActor())
    const checklist = list.find((task) => task.kind === 'confirm_participation')
    expect(checklist).toBeDefined()
    const completed = await service.completeTask(createSubmitterActor(), checklist?.id ?? '')
    expect(completed.status).toBe('completed')
  })
})

describe('readiness with form tasks', () => {
  it('counts the form task only after validated completion', async () => {
    const task = await assignedTask()
    const before = await service.readiness(organizerActor, EVENT_ID)
    expect(before.totalTasks).toBe(4)
    expect(before.completedTasks).toBe(0)

    await expect(
      service.completeTask(createSubmitterActor(), task.id, { av_needs: '' }),
    ).rejects.toBeInstanceOf(ValidationFailedError)
    const afterInvalid = await service.readiness(organizerActor, EVENT_ID)
    expect(afterInvalid.completedTasks).toBe(0)

    await service.completeTask(createSubmitterActor(), task.id, { av_needs: 'Podium mic' })
    const afterValid = await service.readiness(organizerActor, EVENT_ID)
    expect(afterValid.completedTasks).toBe(1)
  })
})

// A form task must reference a real published version: the domain type itself
// carries the reference, so a label-only fake cannot typecheck.
it('SpeakerTask domain type carries the form reference and response', () => {
  const witness: Pick<SpeakerTask, 'formId' | 'formVersionId' | 'response'> = {
    formId: null,
    formVersionId: null,
    response: null,
  }
  expect(witness.formId).toBeNull()
})
