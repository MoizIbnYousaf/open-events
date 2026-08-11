import type {
  ContactId,
  EvaluationAssignment,
  EvaluationAssignmentId,
  EvaluationCommitteeMember,
  EvaluationCriterion,
  EvaluationCriterionId,
  EvaluationRound,
  EvaluationRoundId,
  EvaluationRoundWeight,
  EvaluationScore,
  EventId,
  SubmissionId,
} from '../../domain'

/**
 * Persistence seam for the committee evaluation slice.
 *
 * Every list is event-scoped, so no caller can reach another event's criteria,
 * rounds, assignments or scores by id alone. Ordering is part of the contract
 * and identical in both adapters: criteria by (position, name), rounds by
 * number, assignments by (createdAt, id), scores by (assignmentId,
 * criterionId).
 */
export interface EvaluationRepository {
  listCriteria(eventId: EventId): Promise<readonly EvaluationCriterion[]>
  /** `name` is matched exactly; it is the per-event identity of a criterion. */
  findCriterionByName(eventId: EventId, name: string): Promise<EvaluationCriterion | null>
  /** Upsert keyed on (eventId, name): an existing criterion keeps its id. */
  saveCriterion(criterion: EvaluationCriterion): Promise<EvaluationCriterion>

  listRounds(eventId: EventId): Promise<readonly EvaluationRound[]>
  findRoundById(id: EvaluationRoundId): Promise<EvaluationRound | null>
  findRoundByNumber(eventId: EventId, number: number): Promise<EvaluationRound | null>
  /** Insert-if-absent keyed on (eventId, number); returns the stored round. */
  saveRound(round: EvaluationRound): Promise<EvaluationRound>
  /**
   * Moves a round to closed, recording `recordedWeights` as the rubric it
   * concluded under, and returns it; an already-closed round comes back
   * unchanged with the weights it originally recorded, so a repeated close
   * cannot re-stamp a published result. Null when the round does not exist in
   * the event, so a round id from another event can never be closed.
   */
  closeRound(
    eventId: EventId,
    id: EvaluationRoundId,
    recordedWeights: readonly EvaluationRoundWeight[],
  ): Promise<EvaluationRound | null>

  /**
   * Whether this contact sits on the event's review committee. It answers the
   * one question an empty assignment list cannot: is this an evaluator with
   * nothing to do, or someone who was never on the committee?
   */
  findCommitteeMember(
    eventId: EventId,
    contactId: ContactId,
  ): Promise<EvaluationCommitteeMember | null>
  /** Insert-if-absent keyed on (eventId, contactId); a repeat seat is a no-op. */
  saveCommitteeMember(member: EvaluationCommitteeMember): Promise<EvaluationCommitteeMember>

  findAssignmentById(id: EvaluationAssignmentId): Promise<EvaluationAssignment | null>
  findAssignment(
    eventId: EventId,
    roundId: EvaluationRoundId,
    submissionId: SubmissionId,
    evaluatorContactId: ContactId,
  ): Promise<EvaluationAssignment | null>
  /** Insert-if-absent keyed on (round, submission, evaluator). */
  saveAssignment(assignment: EvaluationAssignment): Promise<EvaluationAssignment>
  listAssignmentsBySubmission(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly EvaluationAssignment[]>
  listAssignmentsByEvaluator(
    eventId: EventId,
    evaluatorContactId: ContactId,
  ): Promise<readonly EvaluationAssignment[]>

  listScoresByAssignment(
    eventId: EventId,
    assignmentId: EvaluationAssignmentId,
  ): Promise<readonly EvaluationScore[]>
  listScoresBySubmission(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly EvaluationScore[]>
  /**
   * How many scores stand against one criterion, across every assignment of
   * the event. It answers a single question — may this criterion still be
   * reordered — without loading rows no caller reads.
   */
  countScoresByCriterion(eventId: EventId, criterionId: EvaluationCriterionId): Promise<number>
  /**
   * Upsert keyed on (assignment, criterion) — and therefore per round, since
   * an assignment belongs to exactly one round. The first `createdAt` and the
   * first row id survive every later write; only rating, comment and
   * `updatedAt` move.
   */
  upsertScore(score: EvaluationScore): Promise<EvaluationScore>
}
