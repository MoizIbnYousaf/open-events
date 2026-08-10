import type { AcceptancePreviewDto, CapturedMessageDto } from '../../application'
import type { SubmissionId } from '../../domain'

import { requestJson } from './admin-events'

/** GET /api/admin/submissions/:id/acceptance-preview — rendered, not sent. */
export function getAcceptancePreview(submissionId: SubmissionId): Promise<AcceptancePreviewDto> {
  return requestJson(
    `/api/admin/submissions/${encodeURIComponent(submissionId)}/acceptance-preview`,
  )
}

/** POST /api/admin/submissions/:id/acceptance-send — idempotent per submission. */
export function sendAcceptance(submissionId: SubmissionId): Promise<CapturedMessageDto> {
  return requestJson(`/api/admin/submissions/${encodeURIComponent(submissionId)}/acceptance-send`, {
    method: 'POST',
  })
}

/** GET /api/admin/submissions/:id/messages — immutable send history. */
export function listSubmissionMessages(
  submissionId: SubmissionId,
): Promise<readonly CapturedMessageDto[]> {
  return requestJson(`/api/admin/submissions/${encodeURIComponent(submissionId)}/messages`)
}
