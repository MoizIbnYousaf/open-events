import type { AnswerMap } from '../../domain/answers'
import type { ContactId } from '../../domain/contact'
import type { EventId, UtcInstant } from '../../domain/event'
import type { FormId } from '../../domain/form'
import type { VersionId } from '../../domain/form-version'
import {
  type SpeakerTask,
  type SpeakerTaskId,
  type SpeakerTaskKind,
  type SpeakerTaskStatus,
} from '../../domain/speaker-task'
import type { SubmissionId } from '../../domain/submission'
import { readinessFromTasksAndAssignments } from '../../domain/readiness-assignments'

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
  readonly formId: FormId | null
  readonly formVersionId: VersionId | null
  readonly response: AnswerMap | null
  /** How completion is evidenced; derived from the kind, labeled honestly. */
  readonly evidence: SpeakerTaskEvidence
}

/** What proves a task done: persisted evidence, or explicit self-attestation. */
export type SpeakerTaskEvidence = 'form_response' | 'bio' | 'headshot' | 'self_attestation'

export function speakerTaskEvidence(kind: SpeakerTaskKind): SpeakerTaskEvidence {
  switch (kind) {
    case 'complete_form':
      return 'form_response'
    case 'submit_bio':
      return 'bio'
    case 'submit_headshot':
      return 'headshot'
    case 'confirm_participation':
      return 'self_attestation'
  }
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
    formId: task.formId,
    formVersionId: task.formVersionId,
    response: task.response,
    evidence: speakerTaskEvidence(task.kind),
  }
}

export function toSubmissionReadinessDto(
  submissionId: SubmissionId,
  title: string,
  tasks: readonly SpeakerTask[],
  extra: { readonly total: number; readonly completed: number } = { total: 0, completed: 0 },
): SubmissionReadinessDto {
  const totals = readinessFromTasksAndAssignments(tasks, extra)
  return {
    submissionId,
    title,
    totalTasks: totals.totalTasks,
    completedTasks: totals.completedTasks,
    percentComplete: totals.percentComplete,
    ready: totals.totalTasks === totals.completedTasks,
  }
}
