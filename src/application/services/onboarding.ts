import type { AnswerMap } from '../../domain/answers'
import type { ContactId } from '../../domain/contact'
import type { EventId } from '../../domain/event'
import type { FormId } from '../../domain/form'
import {
  SPEAKER_TASK_KINDS,
  computeReadinessTotals,
  type SpeakerTask,
  type SpeakerTaskId,
} from '../../domain/speaker-task'
import type { ProposalSubmission, SubmissionId } from '../../domain/submission'
import { defaultAgendaSlot } from '../../domain/agenda'
import { validateAnswersAgainstVersion } from '../../domain/invariants/submission'
import type { OrganizerActor, SubmitterActor } from '../actors'
import type {
  AcceptedSubmissionDto,
  EventReadinessDto,
  SpeakerTaskDto,
  SubmissionReadinessDto,
} from '../dtos/speaker-task.dto'
import type { FormDefinitionDto } from '../dtos/form-definition.dto'
import { toFormDefinitionDto } from '../dtos/form-definition.dto'
import { toSpeakerTaskDto, toSubmissionReadinessDto } from '../dtos/speaker-task.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { AcceptUnitOfWork } from '../ports/accept-unit-of-work'
import type { Clock } from '../ports/clock'
import type { EventRepository } from '../ports/event-repository'
import type { ContactRepository } from '../ports/contact-repository'
import type { FormContentRepository } from '../ports/form-content-repository'
import type { FormRepository } from '../ports/form-repository'
import type { FormVersionRepository } from '../ports/form-version-repository'
import type { SpeakerTaskRepository } from '../ports/speaker-task-repository'
import type { UploadedFileRepository } from '../ports/uploaded-file-repository'
import type { SubmissionRepository } from '../ports/submission-repository'

export interface AssignFormTaskInput {
  readonly formId: FormId
  readonly contactId: ContactId
}

/**
 * Onboarding core: organizer acceptance materialises the speaker checklist,
 * speakers read and complete only their own tasks, and the organizer reads
 * aggregate readiness. Acceptance and completion are both idempotent, every
 * instant comes from the service clock, and the acting identity always comes
 * from a typed actor (never from the request body or a path parameter).
 */
export class OnboardingService {
  readonly #submissions: SubmissionRepository
  readonly #events: EventRepository
  readonly #tasks: SpeakerTaskRepository
  readonly #acceptUnitOfWork: AcceptUnitOfWork
  readonly #clock: Clock
  readonly #forms: FormRepository
  readonly #versions: FormVersionRepository
  readonly #content: FormContentRepository
  readonly #contacts: ContactRepository
  readonly #uploads: UploadedFileRepository

  constructor(
    submissions: SubmissionRepository,
    events: EventRepository,
    tasks: SpeakerTaskRepository,
    acceptUnitOfWork: AcceptUnitOfWork,
    clock: Clock,
    forms: FormRepository,
    versions: FormVersionRepository,
    content: FormContentRepository,
    contacts: ContactRepository,
    uploads: UploadedFileRepository,
  ) {
    this.#submissions = submissions
    this.#events = events
    this.#tasks = tasks
    this.#acceptUnitOfWork = acceptUnitOfWork
    this.#clock = clock
    this.#forms = forms
    this.#versions = versions
    this.#content = content
    this.#contacts = contacts
    this.#uploads = uploads
  }

  /**
   * Accepts a submission, creates one task per checklist kind for every
   * contributor, and places the submission on the agenda as an unassigned
   * draft session so the organizer has something to schedule. Concurrency
   * safety comes from the unit of work: the acceptance row is the idempotency
   * key, so a repeated accept never doubles a checklist or a session, and a
   * partially failing batch writes nothing.
   */
  async accept(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<AcceptedSubmissionDto> {
    const now = this.#clock.now()
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      // Cross-event and absent are deliberately the same safe answer.
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const contributors = await this.#submissions.listContributorsBySubmission(
      submission.eventId,
      submission.id,
    )
    const tasks: SpeakerTask[] = []
    for (const contributor of contributors) {
      for (const [kindIndex, kind] of SPEAKER_TASK_KINDS.entries()) {
        tasks.push({
          id: crypto.randomUUID(),
          eventId: submission.eventId,
          submissionId: submission.id,
          contactId: contributor.contactId,
          kind,
          status: 'pending',
          position: contributor.position * SPEAKER_TASK_KINDS.length + kindIndex,
          createdAt: now,
          completedAt: null,
          formId: null,
          formVersionId: null,
          response: null,
        })
      }
    }

    // The agenda row needs a real day and slot even while it is unassigned;
    // the event start is the meaningful anchor when it is configured, and the
    // acceptance instant is the fallback for an event still without dates.
    const event = await this.#events.findById(submission.eventId)
    const slot = defaultAgendaSlot(event?.dates?.startsAt ?? now)

    const result = await this.#acceptUnitOfWork.execute({
      eventId: submission.eventId,
      submissionId: submission.id,
      acceptedAt: now,
      tasks,
      session: {
        ...slot,
        speakerContactIds: contributors.map((contributor) => contributor.contactId),
      },
    })
    if (result.outcome === 'not-found' || result.acceptance === null) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    return {
      submissionId: submission.id,
      eventId: submission.eventId,
      acceptedAt: result.acceptance.acceptedAt,
      alreadyAccepted: result.outcome === 'already-accepted',
      tasks: result.tasks.map((task) => toSpeakerTaskDto(task, submission.title)),
    }
  }

  /** Every onboarding task owned by the calling speaker, in checklist order. */
  async listTasks(actor: SubmitterActor): Promise<readonly SpeakerTaskDto[]> {
    const tasks = await this.#tasks.listByContact(actor.eventId, actor.contactId)
    const submissionIds = [...new Set(tasks.map((task) => task.submissionId))]
    const submissions = await Promise.all(
      submissionIds.map((submissionId) => this.#submissions.findById(submissionId)),
    )
    const titles = new Map(
      submissionIds.map((submissionId, index) => [submissionId, submissions[index]?.title ?? '']),
    )
    return tasks.map((task) => toSpeakerTaskDto(task, titles.get(task.submissionId) ?? ''))
  }

  /**
   * Assigns a published form to one accepted speaker as a form-backed task.
   * The task pins the form's current published version so the response is
   * always validated against a frozen definition. Re-assigning the same form
   * returns the existing task (idempotent).
   */
  async assignFormTask(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
    input: AssignFormTaskInput,
  ): Promise<SpeakerTaskDto> {
    const now = this.#clock.now()
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    const acceptance = await this.#tasks.findAcceptance(submission.eventId, submission.id)
    if (acceptance === null) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' is not accepted`)
    }
    const contributors = await this.#submissions.listContributorsBySubmission(
      submission.eventId,
      submission.id,
    )
    if (!contributors.some((contributor) => contributor.contactId === input.contactId)) {
      throw new ApplicationError('not_found', `Contact is not a contributor on '${submissionId}'`)
    }
    const form = await this.#forms.findById(input.formId)
    if (form === null || form.eventId !== submission.eventId) {
      throw new ApplicationError('not_found', `Form '${input.formId}' not found`)
    }
    if (form.publishedVersionId === null) {
      throw new ApplicationError('conflict', `Form '${input.formId}' has no published version`)
    }
    const version = await this.#versions.findById(form.publishedVersionId)
    if (version === null || version.status !== 'published') {
      throw new ApplicationError('conflict', `Form '${input.formId}' has no published version`)
    }
    const existing = await this.#tasks.listBySubmission(submission.eventId, submission.id)
    const created = await this.#tasks.createFormTask({
      id: crypto.randomUUID(),
      eventId: submission.eventId,
      submissionId: submission.id,
      contactId: input.contactId,
      kind: 'complete_form',
      status: 'pending',
      position: existing.length,
      createdAt: now,
      completedAt: null,
      formId: form.id,
      formVersionId: version.id,
      response: null,
    })
    return toSpeakerTaskDto(created, submission.title)
  }

  /**
   * The full published definition behind one own form task, for the portal to
   * render. Scoped exactly like completion: not-own or cross-event is 404.
   */
  async getFormTaskDefinition(
    actor: SubmitterActor,
    id: SpeakerTaskId,
  ): Promise<FormDefinitionDto> {
    const task = await this.#tasks.findById(id)
    if (
      task === null ||
      task.eventId !== actor.eventId ||
      task.contactId !== actor.contactId ||
      task.kind !== 'complete_form' ||
      task.formId === null ||
      task.formVersionId === null
    ) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    const [form, version, event] = await Promise.all([
      this.#forms.findById(task.formId),
      this.#versions.findById(task.formVersionId),
      this.#events.findById(task.eventId),
    ])
    if (form === null || version === null || event === null) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    const content = await this.#content.loadByVersion(task.eventId, version.id)
    return toFormDefinitionDto(form, event.slug, version, content, this.#clock.now())
  }

  /**
   * Completes one own task. Another speaker's task — or a task in another
   * event — is a safe 404, never a 403 that would confirm the id exists.
   * A form task completes only with answers that validate against its pinned
   * published version; the validated payload is persisted as the response.
   */
  async completeTask(
    actor: SubmitterActor,
    id: SpeakerTaskId,
    answers?: AnswerMap,
  ): Promise<SpeakerTaskDto> {
    const now = this.#clock.now()
    const task = await this.#tasks.findById(id)
    if (task === null || task.eventId !== actor.eventId || task.contactId !== actor.contactId) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    if (task.status === 'pending' && task.kind === 'submit_bio') {
      const contact = await this.#contacts.findById(actor.contactId)
      const bio = contact?.bio ?? null
      if (bio === null || bio.trim().length === 0) {
        throw new ValidationFailedError(
          'A persisted speaker bio is required before this task can complete',
          [],
        )
      }
    }
    if (task.status === 'pending' && task.kind === 'submit_headshot') {
      const upload = await this.#uploads.findOwn(actor.eventId, actor.contactId, 'headshot')
      if (upload === null) {
        throw new ValidationFailedError(
          'A stored headshot upload is required before this task can complete',
          [],
        )
      }
    }
    let response: AnswerMap | undefined
    if (task.kind === 'complete_form' && task.status === 'pending') {
      if (task.formVersionId === null) {
        throw new ApplicationError('not_found', `Task '${id}' not found`)
      }
      if (answers === undefined) {
        throw new ValidationFailedError('A form task requires answers to complete', [])
      }
      const content = await this.#content.loadByVersion(task.eventId, task.formVersionId)
      const issues = validateAnswersAgainstVersion(content, answers)
      if (issues.length > 0) {
        throw new ValidationFailedError('Answers failed server-side validation', issues)
      }
      response = answers
    }
    const completed = await this.#tasks.markCompleted(actor.eventId, id, now, response)
    if (completed === null) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    return toSpeakerTaskDto(completed, await this.#title(completed.submissionId, new Map()))
  }

  /**
   * The calling speaker's OWN accepted submissions, as ids. Acceptance is a
   * record rather than a status column, so this is the only read that can tell
   * a speaker-facing surface a proposal was accepted. It is scoped twice — to
   * the actor's event and to the submissions the actor owns — so it can never
   * disclose another speaker's decision.
   */
  async listAcceptedOwnSubmissionIds(actor: SubmitterActor): Promise<readonly SubmissionId[]> {
    const own = await this.#submissions.listByOwner(actor.eventId, actor.contactId)
    const acceptances = await Promise.all(
      own.map((submission) => this.#tasks.findAcceptance(actor.eventId, submission.id)),
    )
    return own.flatMap((submission, index) => (acceptances[index] === null ? [] : [submission.id]))
  }

  /** Organizer readiness aggregate over every accepted submission. */
  async readiness(_actor: OrganizerActor, eventId: EventId): Promise<EventReadinessDto> {
    const [acceptances, tasks] = await Promise.all([
      this.#tasks.listAcceptancesByEvent(eventId),
      this.#tasks.listByEvent(eventId),
    ])
    const acceptedSubmissions = await Promise.all(
      acceptances.map((acceptance) => this.#submissions.findById(acceptance.submissionId)),
    )
    const submissions = acceptances.map((acceptance, index): SubmissionReadinessDto => {
      const own = tasks.filter((task) => task.submissionId === acceptance.submissionId)
      return toSubmissionReadinessDto(
        acceptance.submissionId,
        acceptedSubmissions[index]?.title ?? '',
        own,
      )
    })
    const totals = computeReadinessTotals(tasks)
    return {
      eventId,
      acceptedSubmissions: acceptances.length,
      totalTasks: totals.totalTasks,
      completedTasks: totals.completedTasks,
      percentComplete: totals.percentComplete,
      submissions,
    }
  }

  async #title(submissionId: SubmissionId, cache: Map<SubmissionId, string>): Promise<string> {
    const cached = cache.get(submissionId)
    if (cached !== undefined) return cached
    const submission: ProposalSubmission | null = await this.#submissions.findById(submissionId)
    const title = submission?.title ?? ''
    cache.set(submissionId, title)
    return title
  }
}
