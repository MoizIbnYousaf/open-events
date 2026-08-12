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
  RoundCriterion,
  RoundScore,
  SubmissionId,
  UtcInstant,
} from '../../domain'

/**
 * One roster row as the database can assemble it in a single pass: the seat,
 * the person sitting in it, and how much of their reading they have done.
 *
 * `email`/`name` are empty strings rather than null when the contact behind a
 * seat has gone missing — the seat is still real and still removable, and a
 * screen can render an id-only row where it cannot render an absent one.
 */
export interface CommitteeRosterRow {
  readonly contactId: ContactId
  readonly email: string
  readonly name: string
  readonly addedAt: string
  readonly assignedCount: number
  /** Assignments carrying at least one recorded score. Never exceeds `assignedCount`. */
  readonly completedCount: number
}

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
   * Rewrites a round's configuration — its name, its window and whether it is
   * blind. Null when no row matched, which is how a round belonging to another
   * event answers: the event scope lives in the statement that writes.
   *
   * Status is deliberately not settable here. Opening and closing is a
   * transition with its own rule (a closed round never reopens), not a field on
   * a settings form.
   */
  configureRound(
    eventId: EventId,
    roundId: EvaluationRoundId,
    config: {
      readonly name: string
      readonly opensAt: UtcInstant | null
      readonly closesAt: UtcInstant | null
      readonly anonymize: boolean
    },
  ): Promise<EvaluationRound | null>
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
  /** One round's scorecard, in the order the organizer arranged it. */
  listRoundCriteria(eventId: EventId, roundId: EvaluationRoundId): Promise<readonly RoundCriterion[]>
  /**
   * Replaces a round's scorecard wholesale.
   *
   * A scorecard is edited as a whole on one screen, so a partial write would
   * leave a round holding half of two different rubrics. Answers to criteria
   * that no longer exist go with them — a question nobody is asked has no
   * answers to keep.
   */
  replaceRoundCriteria(
    eventId: EventId,
    roundId: EvaluationRoundId,
    criteria: readonly RoundCriterion[],
  ): Promise<readonly RoundCriterion[]>
  /** Every typed answer one assignment carries. */
  listRoundScoresByAssignment(
    eventId: EventId,
    assignmentId: EvaluationAssignmentId,
  ): Promise<readonly RoundScore[]>
  /** Every typed answer against one submission, across its assignments. */
  listRoundScoresBySubmission(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly RoundScore[]>
  /** Upserts one answer on (assignment, criterion); re-scoring edits in place. */
  saveRoundScore(score: RoundScore): Promise<RoundScore>
  /** The contacts pooled into one round, oldest first. */
  listRoundPool(eventId: EventId, roundId: EvaluationRoundId): Promise<readonly ContactId[]>
  /** Replaces a round's pool wholesale, mirroring how the screen edits it. */
  replaceRoundPool(
    eventId: EventId,
    roundId: EvaluationRoundId,
    contactIds: readonly ContactId[],
    addedAt: string,
  ): Promise<void>
  /**
   * The whole roster in ONE read: every seat, the person in it, and their
   * workload, oldest seat first.
   *
   * Deliberately a projection rather than the plain member list. Assembling
   * this from primitives costs a query per member for the contact, another per
   * member for their assignments, and one per assignment for its scores — so a
   * thirty-person committee reading a single screen issued hundreds of round
   * trips. The counts belong in the statement that already visits the rows.
   */
  listCommitteeRoster(eventId: EventId): Promise<readonly CommitteeRosterRow[]>
  /**
   * Gives up one seat. Removing a SEAT is not deleting a PERSON: the contact is
   * a global identity that may be a speaker elsewhere, and any scores they
   * recorded stay where they are — an average the committee already reached
   * does not become untrue because someone left. Idempotent, because "they are
   * not on the committee" is the state the caller asked for either way.
   */
  deleteCommitteeMember(eventId: EventId, contactId: ContactId): Promise<void>

  findAssignmentById(id: EvaluationAssignmentId): Promise<EvaluationAssignment | null>
  findAssignment(
    eventId: EventId,
    roundId: EvaluationRoundId,
    submissionId: SubmissionId,
    evaluatorContactId: ContactId,
  ): Promise<EvaluationAssignment | null>
  /** Insert-if-absent keyed on (round, submission, evaluator). */
  saveAssignment(assignment: EvaluationAssignment): Promise<EvaluationAssignment>
  /** Records that a reviewer has stepped back from one assignment. */
  recuseAssignment(
    eventId: EventId,
    assignmentId: EvaluationAssignmentId,
    recusedAt: UtcInstant,
  ): Promise<void>
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
