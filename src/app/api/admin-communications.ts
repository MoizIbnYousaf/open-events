import type {
  AcceptancePreviewDto,
  AcceptedSubmissionDto,
  CapturedMessageDto,
} from '../../application'
import type { EventSlug, SubmissionId } from '../../domain'

import { requestJson } from './admin-events'

/**
 * POST /api/admin/submissions/:id/accept — records the acceptance and
 * materialises the speaker checklist. Idempotent server-side: a repeat accept
 * returns the same acceptance instant and the same tasks.
 */
export function acceptSubmission(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<AcceptedSubmissionDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/accept`,
    {
      method: 'POST',
    },
  )
}

/** GET /api/admin/submissions/:id/acceptance-preview — rendered, not sent. */
export function getAcceptancePreview(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<AcceptancePreviewDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/acceptance-preview`,
  )
}

/** POST /api/admin/submissions/:id/acceptance-send — one stored row per recipient. */
export function sendAcceptance(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<readonly CapturedMessageDto[]> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/acceptance-send`,
    {
      method: 'POST',
    },
  )
}

/** GET /api/admin/submissions/:id/reminder-preview — rendered, not sent. */
export function getReminderPreview(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<AcceptancePreviewDto> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/reminder-preview`,
  )
}

/** POST /api/admin/submissions/:id/reminder-send — one stored row per recipient. */
export function sendReminder(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<readonly CapturedMessageDto[]> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/reminder-send`,
    {
      method: 'POST',
    },
  )
}

/** GET /api/admin/submissions/:id/messages — immutable send history. */
export function listSubmissionMessages(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<readonly CapturedMessageDto[]> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/messages`,
  )
}
