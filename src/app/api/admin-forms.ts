import type {
  FormVersionDetailDto,
  FormVersionSummaryDto,
  SaveFormDraftInput,
} from '../../application'
import type { FormId, VersionId } from '../../domain'

import { requestJson } from './admin-events'

/** GET /api/admin/forms/:id/draft */
export function getFormDraft(formId: FormId): Promise<FormVersionDetailDto> {
  return requestJson(`/api/admin/forms/${encodeURIComponent(formId)}/draft`)
}

/** GET /api/admin/forms/:id/versions */
export function listFormVersions(formId: FormId): Promise<readonly FormVersionSummaryDto[]> {
  return requestJson(`/api/admin/forms/${encodeURIComponent(formId)}/versions`)
}

/** GET /api/admin/forms/:id/versions/:versionId */
export function getFormVersionDetail(
  formId: FormId,
  versionId: VersionId,
): Promise<FormVersionDetailDto> {
  return requestJson(
    `/api/admin/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(versionId)}`,
  )
}

/** PUT /api/admin/forms/:id/draft — full content replace; ids are reissued server-side. */
export function updateFormDraft(
  formId: FormId,
  input: SaveFormDraftInput,
): Promise<FormVersionDetailDto> {
  return requestJson(`/api/admin/forms/${encodeURIComponent(formId)}/draft`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

/** POST /api/admin/forms/:id/publish */
export function publishForm(formId: FormId): Promise<FormVersionDetailDto> {
  return requestJson(`/api/admin/forms/${encodeURIComponent(formId)}/publish`, {
    method: 'POST',
  })
}
