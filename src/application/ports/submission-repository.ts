import type {
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
  listContributorsBySubmission(
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly SubmissionContributor[]>
}
