import type {
  ContactId,
  EventId,
  SpeakerTask,
  SpeakerTaskId,
  SpeakerTaskKind,
  SpeakerTaskStatus,
  SubmissionId,
  UtcInstant,
} from '../../domain'
import { computeReadinessTotals, isSubmissionReady } from '../../domain'

/** One onboarding task as seen by its owning speaker or by the organizer. */
export interface SpeakerTaskDto {
  readonly id: SpeakerTaskId
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly submissionTitle: string
  readonly contactId: ContactId
  readonly kind: SpeakerTaskKind
  readonly status: SpeakerTaskStatus
  readonly position: number
  readonly createdAt: UtcInstant
  readonly completedAt: UtcInstant | null
}

export interface AcceptedSubmissionDto {
  readonly submissionId: SubmissionId
  readonly eventId: EventId
  readonly acceptedAt: UtcInstant
  /** True when the acceptance already existed (idempotent retry). */
  readonly alreadyAccepted: boolean
  readonly tasks: readonly SpeakerTaskDto[]
}

export interface SubmissionReadinessDto {
  readonly submissionId: SubmissionId
  readonly title: string
  readonly totalTasks: number
  readonly completedTasks: number
  readonly percentComplete: number
  readonly ready: boolean
}

export interface EventReadinessDto {
  readonly eventId: EventId
  readonly acceptedSubmissions: number
  readonly totalTasks: number
  readonly completedTasks: number
  readonly percentComplete: number
  readonly submissions: readonly SubmissionReadinessDto[]
}

export function toSpeakerTaskDto(task: SpeakerTask, submissionTitle: string): SpeakerTaskDto {
  return {
    id: task.id,
    eventId: task.eventId,
    submissionId: task.submissionId,
    submissionTitle,
    contactId: task.contactId,
    kind: task.kind,
    status: task.status,
    position: task.position,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  }
}

export function toSubmissionReadinessDto(
  submissionId: SubmissionId,
  title: string,
  tasks: readonly SpeakerTask[],
): SubmissionReadinessDto {
  const totals = computeReadinessTotals(tasks)
  return {
    submissionId,
    title,
    totalTasks: totals.totalTasks,
    completedTasks: totals.completedTasks,
    percentComplete: totals.percentComplete,
    ready: isSubmissionReady(tasks),
  }
}
