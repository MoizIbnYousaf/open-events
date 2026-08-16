import type { MessageLogEntryDto } from '../../application'
import type { EventSlug } from '../../domain'

import { requestJson } from './admin-events'

/** GET /api/admin/events/:slug/messages — everything this event has sent. */
export function listMessages(slug: EventSlug): Promise<readonly MessageLogEntryDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/messages`)
}
