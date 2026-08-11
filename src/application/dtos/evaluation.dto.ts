import type {
  ContactId,
  EvaluationAssignment,
  EvaluationAssignmentId,
  EvaluationCriterion,
  EvaluationCriterionId,
  EvaluationRound,
  EvaluationRoundId,
  EvaluationRoundStatus,
  EventId,
  SubmissionId,
  UtcInstant,
} from '../../domain'

/** One weighted scoring dimension as the organizer sees it. */
export interface EvaluationCriterionDto {
  readonly id: EvaluationCriterionId
  readonly eventId: EventId
  readonly name: string
  readonly weight: number
  readonly position: number
}

/** One numbered review round as the organizer sees it. */
export interface EvaluationRoundDto {
  readonly id: EvaluationRoundId
  readonly eventId: EventId
  readonly number: number
  readonly name: string
  readonly status: EvaluationRoundStatus
}

/**
 * One committee assignment as the ORGANIZER sees it: the organizer already
 * owns the committee roster, so the evaluator label and email belong here.
 * The evaluator-facing row (`EvaluationRowDto`) never carries them.
 */
export interface EvaluationAssignmentDto {
  readonly id: EvaluationAssignmentId
  readonly eventId: EventId
  readonly roundId: EvaluationRoundId
  readonly submissionId: SubmissionId
  readonly evaluatorContactId: ContactId
  readonly evaluatorEmail: string
  readonly evaluatorName: string
  readonly createdAt: UtcInstant
}

/** What one evaluator recorded in a round that is behind them. */
export interface EvaluationPreviousRoundDto {
  readonly roundNumber: number
  readonly roundName: string
  readonly rating: number
  readonly comments: string | null
  readonly updatedAt: string
}

/**
 * One row of the evaluator's own list: labels only, never emails or contact
 * ids.
 *
 * The row names the round it belongs to, because the same submission can come
 * back round after round and a rating that does not say which round it answers
 * is not a fact anyone can act on. `rating`, `comments` and `updatedAt` are
 * null exactly while this round is unscored — never 0, which is off the 1-5
 * scale and is the one value the write side refuses. `previousRounds` carries
 * what this evaluator themselves recorded in earlier rounds, oldest first, so
 * nobody is asked to re-score blind.
 */
export interface EvaluationRowDto {
  readonly submissionId: SubmissionId
  readonly sessionTitle: string
  readonly roundId: EvaluationRoundId
  readonly roundNumber: number
  readonly roundName: string
  readonly roundStatus: EvaluationRoundStatus
  readonly rating: number | null
  readonly comments: string | null
  readonly updatedAt: string | null
  readonly previousRounds: readonly EvaluationPreviousRoundDto[]
}

/** Per-criterion breakdown behind the weighted totals. */
export interface EvaluationCriterionSummaryDto {
  readonly criterionId: EvaluationCriterionId
  readonly name: string
  readonly weight: number
  readonly scoreCount: number
  readonly ratingSum: number
}

/**
 * What one review round concluded about one submission.
 *
 * Every number here is scoped to this round alone. A closed round keeps
 * reporting exactly what it concluded — including the rubric it was scored
 * under — so a result the committee has published never moves again.
 */
export interface EvaluationRoundSummaryDto {
  readonly roundId: EvaluationRoundId
  readonly number: number
  readonly name: string
  readonly status: EvaluationRoundStatus
  /** Committee members this round asked, one assignment each. */
  readonly assignmentCount: number
  /** Of those, how many recorded at least one rating. */
  readonly scoredCount: number
  readonly scoreCount: number
  readonly weightSum: number
  readonly weightedTotal: number
  /** Weighted average rating in hundredths of a rating point (4.75 -> 475). */
  readonly weightedAverageCentis: number
  readonly criteria: readonly EvaluationCriterionSummaryDto[]
}

/**
 * Organizer-facing weighted totals for one submission.
 *
 * The top-level numbers are the CURRENT round's numbers and `currentRoundId`
 * names it, so a total always says which round it answers. `rounds` carries
 * every round the event has run, oldest first, each with its own result — a
 * finished round stays readable for as long as the event exists instead of
 * disappearing behind the next one.
 */
export interface EvaluationSummaryDto {
  readonly submissionId: SubmissionId
  readonly eventId: EventId
  readonly title: string
  /** The round the headline numbers belong to; null before any round opens. */
  readonly currentRoundId: EvaluationRoundId | null
  readonly assignmentCount: number
  readonly scoredCount: number
  readonly scoreCount: number
  readonly weightSum: number
  readonly weightedTotal: number
  /** Weighted average rating in hundredths of a rating point (4.75 -> 475). */
  readonly weightedAverageCentis: number
  readonly criteria: readonly EvaluationCriterionSummaryDto[]
  readonly rounds: readonly EvaluationRoundSummaryDto[]
}

export function toEvaluationCriterionDto(criterion: EvaluationCriterion): EvaluationCriterionDto {
  return {
    id: criterion.id,
    eventId: criterion.eventId,
    name: criterion.name,
    weight: criterion.weight,
    position: criterion.position,
  }
}

export function toEvaluationRoundDto(round: EvaluationRound): EvaluationRoundDto {
  return {
    id: round.id,
    eventId: round.eventId,
    number: round.number,
    name: round.name,
    status: round.status,
  }
}

export function toEvaluationAssignmentDto(
  assignment: EvaluationAssignment,
  evaluatorEmail: string,
  evaluatorName: string,
): EvaluationAssignmentDto {
  return {
    id: assignment.id,
    eventId: assignment.eventId,
    roundId: assignment.roundId,
    submissionId: assignment.submissionId,
    evaluatorContactId: assignment.evaluatorContactId,
    evaluatorEmail,
    evaluatorName,
    createdAt: assignment.createdAt,
  }
}
