import type {
  FormVersionDetailDto,
  FormVersionSummaryDto,
  SaveFormDraftInput,
} from '../../application'
import type { EventSlug, FormId, VersionId } from '../../domain'

import { requestJson } from './admin-events'

/** GET /api/admin/events/:slug/forms/:id/draft */
export function getFormDraft(slug: EventSlug, formId: FormId): Promise<FormVersionDetailDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/forms/${encodeURIComponent(formId)}/draft`,
  )
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
