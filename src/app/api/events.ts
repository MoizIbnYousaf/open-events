import type { EventDto } from '../../application/dtos/event-dto'

export interface GetEventBySlugOptions {
  readonly signal?: AbortSignal
}

/**
 * Loads a single event from the same-origin API.
 *
 * Returns `null` for a missing event (HTTP 404) so callers can distinguish an
 * empty state from a genuine error.
 */
export async function getEventBySlug(
  slug: string,
  options: GetEventBySlugOptions = {},
): Promise<EventDto | null> {
  const response = await fetch(`/api/events/${slug}`, { signal: options.signal })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to load event "${slug}" (HTTP ${response.status})`)
  }

  return (await response.json()) as EventDto
}
