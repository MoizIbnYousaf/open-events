import type {
  EventId,
  ProposalSubmission,
  SpeakerTask,
  SpeakerTaskId,
  SubmissionId,
} from '../../domain'
import { SPEAKER_TASK_KINDS, computeReadinessTotals } from '../../domain'
import type { OrganizerActor, SubmitterActor } from '../actors'
import type {
  AcceptedSubmissionDto,
  EventReadinessDto,
  SpeakerTaskDto,
  SubmissionReadinessDto,
} from '../dtos/speaker-task.dto'
import { toSpeakerTaskDto, toSubmissionReadinessDto } from '../dtos/speaker-task.dto'
import { ApplicationError } from '../errors'
import type { AcceptUnitOfWork } from '../ports/accept-unit-of-work'
import type { Clock } from '../ports/clock'
import type { SpeakerTaskRepository } from '../ports/speaker-task-repository'
import type { SubmissionRepository } from '../ports/submission-repository'

/**
 * Onboarding core: organizer acceptance materialises the speaker checklist,
 * speakers read and complete only their own tasks, and the organizer reads
 * aggregate readiness. Acceptance and completion are both idempotent, every
 * instant comes from the service clock, and the acting identity always comes
 * from a typed actor (never from the request body or a path parameter).
 */
export class OnboardingService {
  readonly #submissions: SubmissionRepository
  readonly #tasks: SpeakerTaskRepository
  readonly #acceptUnitOfWork: AcceptUnitOfWork
  readonly #clock: Clock

  constructor(
    submissions: SubmissionRepository,
    tasks: SpeakerTaskRepository,
    acceptUnitOfWork: AcceptUnitOfWork,
    clock: Clock,
  ) {
    this.#submissions = submissions
    this.#tasks = tasks
    this.#acceptUnitOfWork = acceptUnitOfWork
    this.#clock = clock
  }

  /**
   * Accepts a submission and creates one task per checklist kind for every
   * contributor. Concurrency safety comes from the unit of work: the acceptance
   * row is the idempotency key, so a repeated accept never doubles a checklist
   * and a partially failing batch writes nothing.
   */
  async accept(_actor: OrganizerActor, submissionId: SubmissionId): Promise<AcceptedSubmissionDto> {
    const now = this.#clock.now()
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null) {
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
        })
      }
    }

    const result = await this.#acceptUnitOfWork.execute({
      eventId: submission.eventId,
      submissionId: submission.id,
      acceptedAt: now,
      tasks,
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
    const titles = new Map<SubmissionId, string>()
    const dtos: SpeakerTaskDto[] = []
    for (const task of tasks) {
      dtos.push(toSpeakerTaskDto(task, await this.#title(task.submissionId, titles)))
    }
    return dtos
  }

  /**
   * Completes one own task. Another speaker's task — or a task in another
   * event — is a safe 404, never a 403 that would confirm the id exists.
   */
  async completeTask(actor: SubmitterActor, id: SpeakerTaskId): Promise<SpeakerTaskDto> {
    const now = this.#clock.now()
    const task = await this.#tasks.findById(id)
    if (task === null || task.eventId !== actor.eventId || task.contactId !== actor.contactId) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    const completed = await this.#tasks.markCompleted(actor.eventId, id, now)
    if (completed === null) {
      throw new ApplicationError('not_found', `Task '${id}' not found`)
    }
    return toSpeakerTaskDto(completed, await this.#title(completed.submissionId, new Map()))
  }

  /** Organizer readiness aggregate over every accepted submission. */
  async readiness(_actor: OrganizerActor, eventId: EventId): Promise<EventReadinessDto> {
    const acceptances = await this.#tasks.listAcceptancesByEvent(eventId)
    const tasks = await this.#tasks.listByEvent(eventId)
    const submissions: SubmissionReadinessDto[] = []
    for (const acceptance of acceptances) {
      const submission = await this.#submissions.findById(acceptance.submissionId)
      const own = tasks.filter((task) => task.submissionId === acceptance.submissionId)
      submissions.push(
        toSubmissionReadinessDto(acceptance.submissionId, submission?.title ?? '', own),
      )
    }
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
