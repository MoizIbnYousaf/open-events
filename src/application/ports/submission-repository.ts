import type {
  AnswerMap,
  ContactId,
  DraftId,
  EventId,
  ProposalSubmission,
  SubmissionContributor,
  SubmissionId,
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
  findByOriginDraftId(originDraftId: DraftId): Promise<ProposalSubmission | null>
  listByEvent(eventId: EventId): Promise<readonly ProposalSubmission[]>
  /**
   * The owner's own submissions for their own event, newest submission first
   * with the id as the deterministic tie-break.
   */
  listByOwner(eventId: EventId, ownerContactId: ContactId): Promise<readonly ProposalSubmission[]>
  listContributorsBySubmission(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly SubmissionContributor[]>
}
