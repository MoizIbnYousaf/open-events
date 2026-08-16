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

/**
 * POST /api/admin/events/:slug/submissions/:id/decision — records the verdict.
 *
 * The product could only ever say yes: acceptance was the single outcome it
 * could store, so an organizer who had turned a proposal down had nowhere to
 * put that and the speaker's portal said "Pending review" for ever. This is the
 * write that ends the wait.
 *
 * Acceptance still goes through `acceptSubmission`, and that is not a split
 * contract: the accept route records the same decision through the same service
 * call, so the two routes cannot disagree about the verdict. It keeps its own
 * path because it also returns the materialised checklist, which this route
 * does not.
 *
 * The response is read for nothing but its success — the verdict the panel then
 * displays is refetched, never assumed from this body.
 */
export function decideSubmission(
  slug: EventSlug,
  submissionId: SubmissionId,
  decision: 'accepted' | 'rejected',
): Promise<unknown> {
  return requestJson(
    `/api/admin/events/${encodeURIComponent(slug)}/submissions/${encodeURIComponent(submissionId)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
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
