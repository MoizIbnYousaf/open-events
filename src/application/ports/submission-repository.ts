import type {
  AnswerMap,
  ContactId,
  DraftId,
  EventId,
  ProposalSubmission,
  SubmissionContributor,
  SubmissionDecision,
  SubmissionDecisionOutcome,
  SubmissionId,
  UtcInstant,
} from '../../domain'

export interface SubmissionRepository {
  findById(id: SubmissionId): Promise<ProposalSubmission | null>
  /**
   * Revises a submitted proposal's title and answers.
   *
   * Scoped by event, id AND owner in the predicate rather than by id alone: an
   * ownership check performed in the service and then discarded on the way to the
   * database is a check that races anything running beside it. A row that does not
   * match all three is reported, never silently skipped.
   */
  updateOwnContent(input: {
    readonly eventId: EventId
    readonly submissionId: SubmissionId
    readonly ownerContactId: ContactId
    readonly title: string
    readonly answers: AnswerMap
  }): Promise<'updated' | 'not-found'>
  /** Organizer revision of title and answers (event + id, no owner check). */
  updateContent(input: {
    readonly eventId: EventId
    readonly submissionId: SubmissionId
    readonly title: string
    readonly answers: AnswerMap
  }): Promise<'updated' | 'not-found'>
  findByOriginDraftId(originDraftId: DraftId): Promise<ProposalSubmission | null>
  listByEvent(eventId: EventId): Promise<readonly ProposalSubmission[]>
  /** Public-CFP intake only; organizer submission and evaluation surfaces use this. */
  listCfpByEvent(eventId: EventId): Promise<readonly ProposalSubmission[]>
  /**
   * The owner's own submissions for their own event, newest submission first
   * with the id as the deterministic tie-break.
   */
  listByOwner(eventId: EventId, ownerContactId: ContactId): Promise<readonly ProposalSubmission[]>
  listContributorsBySubmission(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly SubmissionContributor[]>
  /** The STANDING verdict for one submission of one event — the latest row. */
  findDecision(eventId: EventId, submissionId: SubmissionId): Promise<SubmissionDecision | null>
  /** The whole append-only trail for one submission, oldest verdict first. */
  listDecisionHistory(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly SubmissionDecision[]>
  /** The standing verdict on each of the owner's own submissions. */
  listDecisionsByOwner(
    eventId: EventId,
    ownerContactId: ContactId,
  ): Promise<readonly SubmissionDecision[]>
  /**
   * The standing verdict on every decided submission of one event. Every
   * acceptance-derived read (the agenda board, the speaker checklist, organizer
   * readiness) filters through this, because an acceptance record outlives the
   * decision that produced it by design.
   */
  listDecisionsByEvent(eventId: EventId): Promise<readonly SubmissionDecision[]>
  /**
   * Appends a verdict. Nothing is ever overwritten: a changed decision is a new
   * row with the next `sequence`, so 'accepted then rejected' stays answerable.
   *
   * The event scope lives in the same statement that writes, so naming one
   * event's slug in the path while passing another event's submission id
   * records nothing and is reported as `not-found` rather than silently
   * creating a decision in the wrong programme.
   */
  recordDecision(input: {
    readonly id: string
    readonly eventId: EventId
    readonly submissionId: SubmissionId
    readonly outcome: SubmissionDecisionOutcome
    readonly decidedBy: string
    readonly decidedAt: UtcInstant
  }): Promise<'recorded' | 'not-found'>
}
