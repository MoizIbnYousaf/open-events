import type { ConfirmationRecord, SubmissionId } from '../../domain'

export interface ConfirmationRepository {
  findBySubmissionId(submissionId: SubmissionId): Promise<ConfirmationRecord | null>
}
