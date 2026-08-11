import type {
  FormVersionDetailDto,
  FormVersionSummaryDto,
  SaveFormDraftInput,
} from '../../application'
import type { EventSlug, FormId, VersionId } from '../../domain'

import { ApiClientError, requestJson } from './admin-events'

/**
 * GET /api/admin/events/:slug/forms/:id/draft — 404 maps to null.
 *
 * A form whose only version is published has no draft, and the route answers
 * that with a 404 the same way the public draft probe does. Treating it as a
 * page-level failure killed the whole builder for exactly the state the demo
 * ships in (published v1, no draft): the editor, the rule editors and the
 * preview were unreachable behind a "Not found" card. `null` is "there is no
 * draft yet", which is a state the builder can render.
 *
 * The route answers the same 404 for a form that does not exist at all, so the
 * caller disambiguates with the versions read it already makes: a form that is
 * really missing fails that one too.
 */
export async function getFormDraft(
  slug: EventSlug,
  formId: FormId,
): Promise<FormVersionDetailDto | null> {
  try {
    return await requestJson(
      `/api/admin/events/${encodeURIComponent(slug)}/forms/${encodeURIComponent(formId)}/draft`,
    )
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null
    throw error
  }
}

/** GET /api/admin/events/:slug/forms/:id/versions */
export function listFormVersions(
  slug: EventSlug,
  formId: FormId,
): Promise<readonly FormVersionSummaryDto[]> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/forms/${encodeURIComponent(formId)}/versions`,
  )
}

/** GET /api/admin/forms/:id/versions/:versionId */
export function getFormVersionDetail(
  slug: EventSlug,
  formId: FormId,
  versionId: VersionId,
): Promise<FormVersionDetailDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(versionId)}`,
  )
}

/** PUT /api/admin/forms/:id/draft — full content replace; ids are reissued server-side. */
export function updateFormDraft(
  slug: EventSlug,
  formId: FormId,
  input: SaveFormDraftInput,
): Promise<FormVersionDetailDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/forms/${encodeURIComponent(formId)}/draft`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
}

/** POST /api/admin/forms/:id/publish */
export function publishForm(slug: EventSlug, formId: FormId): Promise<FormVersionDetailDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/forms/${encodeURIComponent(formId)}/publish`,
    {
      method: 'POST',
    },
  )
}
