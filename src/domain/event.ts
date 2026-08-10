/**
 * Pure domain vocabulary for conference events.
 *
 * This module must stay free of framework and persistence imports: it only
 * describes the canonical shape of an event that the rest of the application
 * depends on. All timestamps are UTC instants; times are interpreted in the
 * event's IANA `timezone`.
 */

/** Stable unique identifier of an event (UUID v4 as stored by the adapter). */
export type EventId = string

/** URL-friendly unique key used in public programme routes, e.g. 'demo-conf-2026'. */
export type EventSlug = string

/** IANA timezone identifier, e.g. 'Europe/Berlin'. */
export type IanaTimezone = string

/** ISO 8601 UTC instant, e.g. '2026-05-13T08:00:00.000Z'. */
export type UtcInstant = string

/** Lifecycle state of an event as configured by the organizer. */
export const EVENT_STATUSES = ['draft', 'published', 'archived'] as const

export type EventStatus = (typeof EVENT_STATUSES)[number]

/** Scheduled start and end of an event, in UTC. */
export interface EventDates {
  readonly startsAt: UtcInstant
  readonly endsAt: UtcInstant
}

/** Canonical event entity backing the programme vocabulary. */
export interface Event {
  readonly id: EventId
  readonly slug: EventSlug
  readonly name: string
  readonly timezone: IanaTimezone
  readonly status: EventStatus
  readonly dates: EventDates | null
  /** Public website URL shown on the programme (M2 event configuration). */
  readonly websiteUrl?: string | null
  /** Organizer contact label or email shown on the programme. */
  readonly organizerContact?: string | null
  /** Venue/location label (free-form). */
  readonly venue?: string | null
  /** Event type label (free-form), e.g. 'conference'. */
  readonly eventType?: string | null
}
