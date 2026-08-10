import type {
  EventId,
  EventSlug,
  IanaTimezone,
  SubmissionId,
  TaxonomyItem,
  TaxonomyItemId,
  TaxonomyKey,
  UtcInstant,
} from '../../domain'
import type {
  AgendaConflict,
  AgendaGridDay,
  AgendaSessionAssignment,
  AgendaSessionStatus,
  Req014Views,
} from '../../domain/agenda'

/** One committed room or track the organizer can place a session into. */
export interface AgendaOptionDto {
  readonly id: TaxonomyItemId
  readonly key: TaxonomyKey
  readonly label: string
}

/**
 * One accepted submission on the board. Speakers are deliberately absent: the
 * organizer surface shows titles and placements, and the speaker overlap it
 * needs is already resolved into the conflict set.
 */
export interface AgendaSessionDto {
  readonly submissionId: SubmissionId
  readonly title: string
  readonly day: string
  readonly start: UtcInstant
  readonly end: UtcInstant
  readonly roomId: TaxonomyItemId | null
  readonly roomLabel: string | null
  readonly trackId: TaxonomyItemId | null
  readonly trackLabel: string | null
  readonly position: number | null
  readonly status: AgendaSessionStatus
  readonly assignment: AgendaSessionAssignment
}

/**
 * Everything the organizer agenda needs in one read: the accepted submissions
 * with their current placements, the placeable vocabulary (each day with the
 * slots that day offers, plus rooms and tracks), the deterministic conflict
 * set, and the five canonical views.
 *
 * A day carries its own slots because the event window bounds each day
 * differently; a board-wide slot list would describe one day and misdescribe
 * the rest. Rooms can be empty while days are not — acceptance materialises
 * agenda rows without consulting the taxonomy — so a reader must not take a
 * populated grid as proof that a placement can be made.
 *
 * `windowDays` is how many days the event window covers, which is not always
 * how many `days` carries: a very long window is listed only as far as the
 * board can usefully draw it. Without the total, a reader would take the last
 * listed day for the end of the event and call a placement past it one the
 * window does not offer — while the server goes on accepting placements there.
 */
export interface AgendaBoardDto {
  readonly eventId: EventId
  readonly slug: EventSlug
  readonly timezone: IanaTimezone
  readonly days: readonly AgendaGridDay[]
  readonly windowDays: number
  readonly rooms: readonly AgendaOptionDto[]
  readonly tracks: readonly AgendaOptionDto[]
  readonly sessions: readonly AgendaSessionDto[]
  readonly conflicts: readonly AgendaConflict[]
  readonly views: Req014Views
}

/** Result of moving the event's scheduled sessions to published. */
/** What an assisted placement run did, in the terms an organizer asked in. */
export interface AgendaAutoPlaceResultDto {
  readonly placedCount: number
  /** Sessions the grid had no legal room for — still waiting, never forced. */
  readonly remainingCount: number
  readonly board: AgendaBoardDto
}

export interface AgendaPublishResultDto {
  readonly publishedCount: number
  readonly board: AgendaBoardDto
}

/** One placement request: where a single accepted submission goes. */
export interface PlaceAgendaSessionInput {
  readonly day: string
  readonly roomId: TaxonomyItemId
  readonly trackId: TaxonomyItemId | null
  readonly start: UtcInstant
  readonly end: UtcInstant
}

export function toAgendaOptionDto(item: TaxonomyItem): AgendaOptionDto {
  return { id: item.id, key: item.key, label: item.label }
}
