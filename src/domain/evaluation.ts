import type { ContactId } from './contact.ts'
import type { EventId, UtcInstant } from './event.ts'
import type { SubmissionId } from './submission.ts'

/**
 * Committee evaluation vocabulary: an organizer defines weighted criteria and
 * numbered review rounds, assigns evaluators to submissions, and reads the
 * weighted totals of the ratings those evaluators record.
 *
 * Every function here is pure: no clock, no identifiers minted, no I/O. All
 * arithmetic stays in integers, and the single rounding rule
 * (`roundHalfUpDivision`) is the only place a quotient is ever rounded.
 */

export type EvaluationCriterionId = string
export type EvaluationRoundId = string
export type EvaluationAssignmentId = string
export type EvaluationScoreId = string

/** A round is opened once and can only ever move on to closed. */
export const EVALUATION_ROUND_STATUSES = ['open', 'closed'] as const

export type EvaluationRoundStatus = (typeof EVALUATION_ROUND_STATUSES)[number]

/** Inclusive rating scale shared by the evaluator UI and the storage CHECK. */
export const EVALUATION_RATING_MIN = 1
export const EVALUATION_RATING_MAX = 5

/** A criterion must carry at least unit weight, otherwise it cannot count. */
export const EVALUATION_WEIGHT_MIN = 1

/** One weighted scoring dimension of an event, ordered by `position`. */
export interface EvaluationCriterion {
  readonly id: EvaluationCriterionId
  readonly eventId: EventId
  readonly name: string
  readonly weight: number
  readonly position: number
}

/** The weight one criterion carried at a single moment in time. */
export interface EvaluationRoundWeight {
  readonly criterionId: EvaluationCriterionId
  readonly weight: number
}

/**
 * One numbered review round of an event.
 *
 * `recordedWeights` is the rubric the round concluded under, taken when the
 * round closed. A closed round reports what it decided, so retuning the
 * criteria for the next round cannot rewrite a result the committee has
 * already published. It is null while the round is open, because an open
 * round is still being decided and follows the live weights.
 */
export interface EvaluationRound {
  readonly id: EvaluationRoundId
  readonly eventId: EventId
  readonly number: number
  readonly name: string
  readonly status: EvaluationRoundStatus
  readonly recordedWeights: readonly EvaluationRoundWeight[] | null
}

/**
 * The authority on what an evaluator may score: one committee member, one
 * submission, one round. Scores hang off the assignment, so the assignment is
 * both the scoping rule and the round membership of every score under it.
 */
export interface EvaluationAssignment {
  readonly id: EvaluationAssignmentId
  readonly eventId: EventId
  readonly roundId: EvaluationRoundId
  readonly submissionId: SubmissionId
  readonly evaluatorContactId: ContactId
  readonly createdAt: UtcInstant
}

/**
 * A seat on an event's review committee.
 *
 * Assignments say what a member has been given to read; this says they are a
 * member at all. The distinction is what lets an evaluator with an empty queue
 * be told their queue is empty, while someone who was never on the committee
 * never sees the surface.
 */
export interface EvaluationCommitteeMember {
  readonly eventId: EventId
  readonly contactId: ContactId
  readonly addedAt: UtcInstant
}

/** One rating on one criterion of one assignment; re-scoring updates in place. */
export interface EvaluationScore {
  readonly id: EvaluationScoreId
  readonly eventId: EventId
  readonly assignmentId: EvaluationAssignmentId
  readonly criterionId: EvaluationCriterionId
  readonly rating: number
  readonly comment: string | null
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/** True only for an integer inside the inclusive 1-5 rating scale. */
export function isValidEvaluationRating(value: unknown): value is number {
  return isInteger(value) && value >= EVALUATION_RATING_MIN && value <= EVALUATION_RATING_MAX
}

/** True only for an integer weight at or above the minimum of one. */
export function isValidCriterionWeight(value: unknown): value is number {
  return isInteger(value) && value >= EVALUATION_WEIGHT_MIN
}

/** True only for a non-negative integer ordering position. */
export function isValidCriterionPosition(value: unknown): value is number {
  return isInteger(value) && value >= 0
}

/** Legal round transitions: open -> closed, plus same-status no-ops. */
export function canTransitionRoundStatus(
  from: EvaluationRoundStatus,
  to: EvaluationRoundStatus,
): boolean {
  if (from === to) return true
  return from === 'open' && to === 'closed'
}

/**
 * Closes a round, recording the rubric it concluded under. Closing an already
 * closed round is the identity, so a repeated close can never re-stamp a
 * result with weights that arrived after the fact.
 */
export function closeEvaluationRound(
  round: EvaluationRound,
  recordedWeights: readonly EvaluationRoundWeight[],
): EvaluationRound {
  if (round.status === 'closed') return round
  return { ...round, status: 'closed', recordedWeights }
}

/** The criteria weights as they stand now, in the order the criteria list. */
export function snapshotCriterionWeights(
  criteria: readonly EvaluationCriterion[],
): readonly EvaluationRoundWeight[] {
  return criteria.map((criterion) => ({ criterionId: criterion.id, weight: criterion.weight }))
}

/**
 * The weights one round's totals stand on: what it recorded when it closed,
 * or the live criteria while it is still open. A closed round that recorded
 * nothing falls back to the live weights rather than losing its ratings.
 */
export function evaluationRoundWeights(
  round: EvaluationRound,
  criteria: readonly EvaluationCriterion[],
): ReadonlyMap<EvaluationCriterionId, number> {
  const recorded = round.status === 'closed' ? round.recordedWeights : null
  if (recorded !== null && recorded.length > 0) {
    return new Map(recorded.map((entry) => [entry.criterionId, entry.weight]))
  }
  return new Map(criteria.map((criterion) => [criterion.id, criterion.weight]))
}

/**
 * The event's default criterion — the one a single-rating evaluator surface
 * scores. Lowest `position` wins, with the name as the deterministic
 * tie-break so two criteria sharing a position still resolve identically.
 */
export function selectDefaultCriterion(
  criteria: readonly EvaluationCriterion[],
): EvaluationCriterion | null {
  let best: EvaluationCriterion | null = null
  for (const candidate of criteria) {
    if (best === null) {
      best = candidate
      continue
    }
    if (candidate.position < best.position) {
      best = candidate
    } else if (candidate.position === best.position && candidate.name < best.name) {
      best = candidate
    }
  }
  return best
}

/**
 * The live round of an event: the open round with the HIGHEST number, null
 * when every round is closed.
 *
 * Rounds run forwards. Opening round 2 is the organizer saying 'this is where
 * review happens now', so an assignment made without naming a round belongs
 * to round 2 — under the opposite rule the organizer could not staff the round
 * they had just created, and every rating filed into it was unreachable.
 */
export function selectOpenRound(rounds: readonly EvaluationRound[]): EvaluationRound | null {
  let best: EvaluationRound | null = null
  for (const candidate of rounds) {
    if (candidate.status !== 'open') continue
    if (best === null || candidate.number > best.number) best = candidate
  }
  return best
}

/**
 * The round a submission's headline result belongs to: the live round when one
 * is open, otherwise the last round that ran. Null only for an event whose
 * organizer has opened no round at all.
 */
export function selectCurrentRound(rounds: readonly EvaluationRound[]): EvaluationRound | null {
  const open = selectOpenRound(rounds)
  if (open !== null) return open
  let latest: EvaluationRound | null = null
  for (const candidate of rounds) {
    if (latest === null || candidate.number > latest.number) latest = candidate
  }
  return latest
}

/**
 * How live one assignment is, the single rule behind every selection below.
 * `group` 0 is an open round, 1 a closed one and 2 a round that is not in the
 * event at all; the lower `group` always wins. Within a group the highest
 * round number wins, so the newest round is the live one whatever its status —
 * the tie-break never flips direction when a round closes.
 */
function assignmentRank(
  assignment: EvaluationAssignment,
  rounds: ReadonlyMap<EvaluationRoundId, EvaluationRound>,
): readonly [number, number] {
  const round = rounds.get(assignment.roundId)
  if (round === undefined) return [2, 0]
  return [round.status === 'open' ? 0 : 1, -round.number]
}

/**
 * The single live assignment of every key, ranked by `assignmentRank`. The
 * first assignment of a key holds the slot until one that ranks lower takes
 * it, so insertion order is preserved and every key yields exactly one entry.
 */
function selectLiveAssignments<K>(
  assignments: readonly EvaluationAssignment[],
  rounds: readonly EvaluationRound[],
  keyOf: (assignment: EvaluationAssignment) => K,
): Map<K, EvaluationAssignment> {
  const byId = new Map(rounds.map((round) => [round.id, round]))
  const live = new Map<K, EvaluationAssignment>()
  for (const assignment of assignments) {
    const key = keyOf(assignment)
    const held = live.get(key)
    if (held === undefined) {
      live.set(key, assignment)
      continue
    }
    const [group, order] = assignmentRank(assignment, byId)
    const [heldGroup, heldOrder] = assignmentRank(held, byId)
    if (group < heldGroup || (group === heldGroup && order < heldOrder)) {
      live.set(key, assignment)
    }
  }
  return live
}

/**
 * One assignment per submission for the evaluator's single-rating surface.
 *
 * An evaluator can legitimately hold the same submission in several rounds, so
 * a raw assignment list would show one session twice with nothing to tell the
 * copies apart. The chosen assignment is the highest-numbered OPEN round they
 * hold on that submission — exactly the round a score is written to — so the
 * list and the write can never mean different rounds. When every round they
 * hold on it is closed, the highest-numbered one stands, so a finished round
 * still shows the rating it recorded. Insertion order of `assignments` is
 * preserved, one entry per submission.
 */
export function selectSurfaceAssignments(
  assignments: readonly EvaluationAssignment[],
  rounds: readonly EvaluationRound[],
): ReadonlyMap<SubmissionId, EvaluationAssignment> {
  return selectLiveAssignments(assignments, rounds, (assignment) => assignment.submissionId)
}

/**
 * The assignments one round holds, in insertion order.
 *
 * A committee total belongs to exactly one round, and storage already allows a
 * member only one assignment per round, so this filter is the whole membership
 * rule behind a round's numbers. Nothing is ever gathered across rounds: a
 * total built from a live round-2 slot beside a leftover round-1 rating
 * describes neither round, and a number nobody can name is a number nobody
 * can read.
 */
export function selectRoundAssignments(
  assignments: readonly EvaluationAssignment[],
  roundId: EvaluationRoundId,
): readonly EvaluationAssignment[] {
  return assignments.filter((assignment) => assignment.roundId === roundId)
}

/** One rating paired with the weight of the criterion it was given on. */
export interface WeightedScore {
  readonly weight: number
  readonly rating: number
}

export interface WeightedTotals {
  readonly scoreCount: number
  readonly weightSum: number
  /** Sum of rating x weight over every score; exact, never rounded. */
  readonly weightedTotal: number
  /**
   * Weighted average rating in hundredths of a rating point (a 4.75 average
   * is 475). Zero when there are no scores.
   */
  readonly weightedAverageCentis: number
}

/**
 * The single rounding rule of the evaluation slice: integer division rounding
 * halves up, on non-negative operands only. A zero denominator yields zero so
 * an empty score set never divides.
 */
export function roundHalfUpDivision(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.floor((2 * numerator + denominator) / (2 * denominator))
}

/** Weighted totals over a score set; order independent and integer-only. */
export function computeWeightedTotals(scores: readonly WeightedScore[]): WeightedTotals {
  let weightSum = 0
  let weightedTotal = 0
  for (const score of scores) {
    weightSum += score.weight
    weightedTotal += score.weight * score.rating
  }
  return {
    scoreCount: scores.length,
    weightSum,
    weightedTotal,
    weightedAverageCentis: roundHalfUpDivision(weightedTotal * 100, weightSum),
  }
}
