import type {
  ContactId,
  EvaluationAssignment,
  EvaluationAssignmentId,
  EvaluationCriterion,
  EvaluationCriterionId,
  EvaluationRound,
  EvaluationRoundId,
  EvaluationRoundStatus,
  EvaluationScore,
  EventId,
  SubmissionId,
  SubmissionOutcome,
  UtcInstant,
} from '../../domain'
import type { ContributorDto } from './submission.dto'

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
  /** Null on a round nobody has dated; a window is offered, not required. */
  readonly opensAt: string | null
  readonly closesAt: string | null
  /** Whether reviewers are hidden from one another in this round. */
  readonly anonymize: boolean
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
  /**
   * What this reviewer actually said, on the event's default criterion. Null
   * while the assignment is unscored — an unscored reviewer is reported as
   * unscored rather than dropped, because 'nobody has read this yet' and 'one
   * of three has read it' are different things for an organizer deciding.
   */
  readonly rating: number | null
  readonly comment: string | null
  readonly updatedAt: UtcInstant | null
}

/**
 * One reviewer's review of one submission in one round, for the ORGANIZER.
 *
 * There is no blind or anonymised review anywhere in this domain today, so
 * naming the reviewer here regresses nothing. IF blinding is ever introduced,
 * THIS is the DTO that has to learn about it: it is the only place an
 * individual reviewer's identity and their words travel together.
 */
export interface EvaluationReviewDto {
  readonly assignmentId: EvaluationAssignmentId
  readonly evaluatorContactId: ContactId
  readonly evaluatorEmail: string
  readonly evaluatorName: string | null
  readonly rating: number | null
  readonly comment: string | null
  readonly updatedAt: UtcInstant | null
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
  /**
   * The round's own questions, when it carries a typed scorecard. Absent on a
   * round using the legacy single rating, so a form can tell "this round asks
   * three things" from "this round asks the one thing it always did".
   */
  readonly criteria?: readonly EvaluationRowCriterionDto[]
  /**
   * Whose proposal this is — null in a blind round, where the reviewer is not
   * meant to know. Withheld on the SERVER rather than hidden by the screen: a
   * name that reaches the browser has been disclosed whatever the CSS says.
   */
  readonly speakerName?: string | null
  /** True when this round is blind, so the surface can say why the name is absent. */
  readonly anonymized?: boolean
}

/** One question on a reviewer's form, with whatever they have answered so far. */
export interface EvaluationRowCriterionDto {
  readonly id: string
  readonly label: string
  readonly kind: 'rating' | 'select' | 'text'
  readonly weight: number | null
  readonly scale: { readonly min: number; readonly max: number } | null
  readonly options: readonly string[] | null
  /** Null while unanswered — a real state, not a missing field. */
  readonly value: number | string | null
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
  /**
   * The individual reviews behind the aggregates, ordered by assignment. An
   * organizer deciding a proposal has to be able to read what the committee
   * SAID, not only the weighted number it came to.
   */
  readonly reviews: readonly EvaluationReviewDto[]
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
  /** The current round's individual reviews, mirroring `rounds[current]`. */
  readonly reviews: readonly EvaluationReviewDto[]
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
    opensAt: round.opensAt,
    closesAt: round.closesAt,
    anonymize: round.anonymize,
  }
}

export function toEvaluationAssignmentDto(
  assignment: EvaluationAssignment,
  evaluatorEmail: string,
  evaluatorName: string,
  score: EvaluationScore | null = null,
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
    rating: score?.rating ?? null,
    comment: score?.comment ?? null,
    updatedAt: score?.updatedAt ?? null,
  }
}

/**
 * One proposal's line in the results table.
 *
 * `weightedAverageCentis` is null — never 0 — when nobody has scored the
 * proposal yet. Zero is a score a reviewer can legitimately give, and
 * conflating the two would rank an unread proposal below a badly-reviewed one
 * and quietly mislead the committee that is ranking them.
 *
 * Centis (hundredths) rather than a float, matching the per-submission summary:
 * a table sorts and a person reads the same number, and rounding it once at the
 * edge beats rounding it differently on every surface.
 */
export interface EvaluationResultRowDto {
  readonly submissionId: SubmissionId
  readonly title: string
  readonly weightedAverageCentis: number | null
  readonly assignmentCount: number
  readonly scoredCount: number
  readonly decision: SubmissionOutcome
  readonly contributors: readonly ContributorDto[]
}
