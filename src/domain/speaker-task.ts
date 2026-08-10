import type { ContactId } from './contact.ts'
import type { EventId, UtcInstant } from './event.ts'
import type { SubmissionId } from './submission.ts'

export type SpeakerTaskId = string

/**
 * Onboarding checklist a speaker must clear once their proposal is accepted.
 * The list is fixed and ordered: every accepted speaker receives exactly one
 * task per kind, in this order, so `position` is derived and never supplied by
 * a client.
 */
export const SPEAKER_TASK_KINDS = [
  'confirm_participation',
  'submit_bio',
  'submit_headshot',
] as const

export type SpeakerTaskKind = (typeof SPEAKER_TASK_KINDS)[number]

export const SPEAKER_TASK_STATUSES = ['pending', 'completed'] as const

export type SpeakerTaskStatus = (typeof SPEAKER_TASK_STATUSES)[number]

/**
 * One onboarding task owned by one speaker (contact) on one accepted
 * submission. `completedAt` is set exactly when `status` is `'completed'` —
 * the migration enforces the same coupling in SQL.
 */
export interface SpeakerTask {
  readonly id: SpeakerTaskId
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly contactId: ContactId
  readonly kind: SpeakerTaskKind
  readonly status: SpeakerTaskStatus
  readonly position: number
  readonly createdAt: UtcInstant
  readonly completedAt: UtcInstant | null
}

/** Acceptance record for a submission; its existence IS the accepted state. */
export interface SubmissionAcceptance {
  readonly eventId: EventId
  readonly submissionId: SubmissionId
  readonly acceptedAt: UtcInstant
}

export interface ReadinessTotals {
  readonly totalTasks: number
  readonly completedTasks: number
  /** Integer 0-100; an empty checklist is vacuously complete (100). */
  readonly percentComplete: number
}

/** Pure readiness math over a task set — no I/O, no clock. */
export function computeReadinessTotals(tasks: readonly SpeakerTask[]): ReadinessTotals {
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const percentComplete = totalTasks === 0 ? 100 : Math.round((completedTasks / totalTasks) * 100)
  return { totalTasks, completedTasks, percentComplete }
}

/** A submission is ready when every task on its checklist is completed. */
export function isSubmissionReady(tasks: readonly SpeakerTask[]): boolean {
  return tasks.every((task) => task.status === 'completed')
}

/** Marks a task completed; completing an already-completed task is a no-op. */
export function completeSpeakerTask(task: SpeakerTask, completedAt: UtcInstant): SpeakerTask {
  if (task.status === 'completed') return task
  return { ...task, status: 'completed', completedAt }
}
