import type {
  ContactId,
  DraftId,
  EventId,
  ProposalSubmission,
  SubmissionContributor,
  SubmissionId,
} from '../../domain'

export interface SubmissionRepository {
  findById(id: SubmissionId): Promise<ProposalSubmission | null>
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
