import type { SubmissionDetailDto, SubmissionListItemDto } from '../../application'
import type {
  SubmissionDeskDto,
  SubmissionDeskQuery,
} from '../../application/dtos/submission-desk.dto'
import type { EventSlug, SubmissionId } from '../../domain'

import { ApiClientError, requestJson } from './admin-events'
import { APP_SEARCH_PARAM_KEYS } from '../lib/search-param-keys'

/** GET /api/admin/events/:slug/submissions — organizer list rows. */
export function listSubmissions(slug: EventSlug): Promise<readonly SubmissionListItemDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/submissions`)
}

/** GET /api/admin/events/:slug/submission-desk — filtered organizer read model. */
export function listSubmissionDesk(
  slug: EventSlug,
  query: SubmissionDeskQuery,
): Promise<SubmissionDeskDto> {
  const keys = APP_SEARCH_PARAM_KEYS.submissions
  const search = new URLSearchParams()
  if (query.q !== '') search.set(keys.query, query.q)
  if (query.decision !== 'all') search.set(keys.decision, query.decision)
  if (query.routing !== 'all') search.set(keys.routing, query.routing)
  if (query.sort !== 'submitted-desc') search.set(keys.sort, query.sort)
  if (query.page !== 1) search.set(keys.page, String(query.page))
  if (query.facets.length > 0) search.set(keys.facets, JSON.stringify(query.facets))
  const encoded = search.toString()
  const suffix = encoded === '' ? '' : `?${encoded}`
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/submission-desk${suffix}`)
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
