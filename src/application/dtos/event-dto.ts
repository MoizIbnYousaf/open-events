import type { Event, EventId, EventSlug, EventStatus, IanaTimezone, UtcInstant } from '../../domain'
import { publicEventBrandingPath } from '../public-path'

/** API response shape for a single event. */
export interface EventDto {
  readonly id: EventId
  readonly slug: EventSlug
  readonly name: string
  readonly timezone: IanaTimezone
  readonly status: EventStatus
  readonly startsAt: UtcInstant | null
  readonly endsAt: UtcInstant | null
  readonly logoUrl: string | null
  readonly logoWidth: number | null
  readonly logoHeight: number | null
  readonly logoUpdatedAt: UtcInstant | null
  readonly backgroundUrl: string | null
  readonly backgroundWidth: number | null
  readonly backgroundHeight: number | null
  readonly backgroundUpdatedAt: UtcInstant | null
}

/** Maps a domain event to its public API representation. */
export function toEventDto(event: Event): EventDto {
  const logo = event.branding?.logo ?? null
  const background = event.branding?.background ?? null
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    timezone: event.timezone,
    status: event.status,
    startsAt: event.dates?.startsAt ?? null,
    endsAt: event.dates?.endsAt ?? null,
    logoUrl: logo === null ? null : publicEventBrandingPath(event.slug, 'logo', logo.updatedAt),
    logoWidth: logo?.width ?? null,
    logoHeight: logo?.height ?? null,
    logoUpdatedAt: logo?.updatedAt ?? null,
    backgroundUrl:
      background === null
        ? null
        : publicEventBrandingPath(event.slug, 'background', background.updatedAt),
    backgroundWidth: background?.width ?? null,
    backgroundHeight: background?.height ?? null,
    backgroundUpdatedAt: background?.updatedAt ?? null,
  }
}
