import type { SubmissionDetailDto, SubmissionListItemDto } from '../../application'
import type { EventSlug, SubmissionId } from '../../domain'

import { ApiClientError, requestJson } from './admin-events'

/** GET /api/admin/events/:slug/submissions — organizer list rows. */
export function listSubmissions(slug: EventSlug): Promise<readonly SubmissionListItemDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/submissions`)
}

/** GET /api/admin/events/:slug/submissions/:id — 404 (missing/cross-event) -> null. */
export async function getSubmissionDetail(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<SubmissionDetailDto | null> {
  try {
    return await requestJson(
      `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}`,
    )
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null
    throw error
  }
}
