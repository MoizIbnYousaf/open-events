export const PROGRAMME_TIMELINE_LIMIT = 100

export const PROGRAMME_TIMELINE_CATEGORIES = [
  'submissions',
  'reviews',
  'decisions',
  'onboarding',
  'communications',
  'schedule',
] as const

export type ProgrammeTimelineCategory = (typeof PROGRAMME_TIMELINE_CATEGORIES)[number]

export const PROGRAMME_TIMELINE_FILTERS = ['all', ...PROGRAMME_TIMELINE_CATEGORIES] as const
export type ProgrammeTimelineFilter = (typeof PROGRAMME_TIMELINE_FILTERS)[number]

export const PROGRAMME_TIMELINE_KINDS = [
  'proposal_submitted',
  'direct_session_created',
  'review_assigned',
  'review_recused',
  'review_saved',
  'decision_accepted',
  'decision_rejected',
  'speaker_task_assigned',
  'speaker_task_completed',
  'confirmation_recorded',
  'acceptance_recorded',
  'reminder_recorded',
  'schedule_current',
] as const

export type ProgrammeTimelineKind = (typeof PROGRAMME_TIMELINE_KINDS)[number]

/** One source-backed milestone. Presentation copy never contains raw record ids. */
export interface ProgrammeTimelineItemDto {
  readonly id: string
  readonly kind: ProgrammeTimelineKind
  readonly category: ProgrammeTimelineCategory
  readonly occurredAt: string
  readonly title: string
  readonly detail: string
  readonly submissionId: string | null
  readonly submissionTitle: string | null
}

export interface ProgrammeTimelineDto {
  readonly category: ProgrammeTimelineFilter
  readonly items: readonly ProgrammeTimelineItemDto[]
  readonly limit: number
  /** True when at least one matching milestone exists beyond this bounded projection. */
  readonly truncated: boolean
}
