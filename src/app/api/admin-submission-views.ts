import type {
  SubmissionViewDto,
  SubmissionViewState,
} from '../../application/dtos/submission-view.dto'
import type { EventSlug } from '../../domain'
import { requestJson } from './admin-events'

function viewsPath(slug: EventSlug): string {
  return `/api/admin/events/${encodeURIComponent(slug)}/submission-views`
}

export function listSubmissionViews(slug: EventSlug): Promise<readonly SubmissionViewDto[]> {
  return requestJson(viewsPath(slug))
}

export function createSubmissionView(
  slug: EventSlug,
  input: { readonly name: string; readonly state: SubmissionViewState },
): Promise<SubmissionViewDto> {
  return requestJson(viewsPath(slug), { method: 'POST', body: JSON.stringify(input) })
}

export function deleteSubmissionView(
  slug: EventSlug,
  id: string,
): Promise<{ readonly deleted: true }> {
  return requestJson(`${viewsPath(slug)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  })
}
