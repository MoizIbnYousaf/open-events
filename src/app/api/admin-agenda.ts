import type {
  AgendaAutoPlaceResultDto,
  AgendaBoardDto,
  AgendaPublishResultDto,
  PlaceAgendaSessionInput,
} from '../../application'
import type { EventSlug, SubmissionId } from '../../domain'

import { requestJson } from './admin-events'

function agendaPath(slug: EventSlug): string {
  return `/api/admin/events/${encodeURIComponent(slug)}/agenda`
}

/** GET /api/admin/events/:slug/agenda */
export function getAgendaBoard(slug: EventSlug): Promise<AgendaBoardDto> {
  return requestJson(agendaPath(slug))
}

/** PUT /api/admin/events/:slug/agenda/:submissionId — returns the whole board. */
export function placeAgendaSession(
  slug: EventSlug,
  submissionId: SubmissionId,
  placement: PlaceAgendaSessionInput,
): Promise<AgendaBoardDto> {
  return requestJson(`${agendaPath(slug)}/${encodeURIComponent(submissionId)}`, {
    method: 'PUT',
    body: JSON.stringify(placement),
  })
}

/** DELETE /api/admin/events/:slug/agenda/:submissionId — returns the whole board. */
export function unplaceAgendaSession(
  slug: EventSlug,
  submissionId: SubmissionId,
): Promise<AgendaBoardDto> {
  return requestJson(`${agendaPath(slug)}/${encodeURIComponent(submissionId)}`, {
    method: 'DELETE',
  })
}

/**
 * POST /api/admin/events/:slug/agenda/auto-place — fill the grid's free slots
 * with the unscheduled sessions, never creating a conflict.
 */
export function autoPlaceAgenda(slug: EventSlug): Promise<AgendaAutoPlaceResultDto> {
  return requestJson(`${agendaPath(slug)}/auto-place`, { method: 'POST' })
}

/** POST /api/admin/events/:slug/agenda/publish — idempotent, scheduled-only. */
export function publishAgenda(slug: EventSlug): Promise<AgendaPublishResultDto> {
  return requestJson(`${agendaPath(slug)}/publish`, { method: 'POST' })
}
