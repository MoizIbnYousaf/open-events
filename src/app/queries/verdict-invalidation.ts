import type { EventSlug, SubmissionId } from '../../domain'
import { adminCommunicationQueryKeys } from './admin-communications'
import { eventReadModelKeysFor } from './event-read-model-cache'

/**
 * Queries that must refetch after an accept or reject.
 *
 * The verdict is a record the submissions list also prints. Invalidating only
 * the acceptance preview leaves the table showing Pending for staleTime.
 */
export function queriesInvalidatedOnVerdict(slug: EventSlug, submissionId: SubmissionId) {
  return [
    adminCommunicationQueryKeys.acceptancePreview(submissionId),
    ...eventReadModelKeysFor(slug, 'verdict'),
  ] as const
}
