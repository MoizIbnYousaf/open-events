export const EMBED_KINDS = ['sessions', 'speakers', 'agenda', 'itinerary', 'gallery'] as const
export type EmbedKind = (typeof EMBED_KINDS)[number]

export const EMBED_FORMATS = ['html', 'json', 'xml', 'ical'] as const
export type EmbedFormat = (typeof EMBED_FORMATS)[number]

export const EMBED_PUBLICATIONS = [
  { kind: 'agenda', format: 'html', label: 'Agenda widget' },
  { kind: 'gallery', format: 'html', label: 'Speaker gallery widget' },
  { kind: 'itinerary', format: 'html', label: 'Itinerary widget' },
  { kind: 'sessions', format: 'json', label: 'Sessions JSON feed' },
  { kind: 'speakers', format: 'json', label: 'Speakers JSON feed' },
  { kind: 'agenda', format: 'ical', label: 'Full schedule iCalendar feed' },
] as const satisfies readonly {
  readonly kind: EmbedKind
  readonly format: EmbedFormat
  readonly label: string
}[]

export function isEmbedKind(value: unknown): value is EmbedKind {
  return typeof value === 'string' && (EMBED_KINDS as readonly string[]).includes(value)
}

export function isEmbedFormat(value: unknown): value is EmbedFormat {
  return typeof value === 'string' && (EMBED_FORMATS as readonly string[]).includes(value)
}

export function isEmbedPublication(kind: unknown, format: unknown): boolean {
  return EMBED_PUBLICATIONS.some(
    (publication) => publication.kind === kind && publication.format === format,
  )
}

export interface EmbedRecord {
  readonly id: string
  readonly eventId: string
  readonly name: string
  readonly kind: EmbedKind
  readonly format: EmbedFormat
  readonly enabled: boolean
  readonly brandColor: string
  readonly trackFilter: string
  readonly createdAt: string
  readonly updatedAt: string
}

export const SPEAKER_WORKFLOW_STATUSES = ['invited', 'confirmed', 'accepted', 'declined'] as const
export type SpeakerWorkflowStatus = (typeof SPEAKER_WORKFLOW_STATUSES)[number]

export function isSpeakerWorkflowStatus(value: unknown): value is SpeakerWorkflowStatus {
  return (
    typeof value === 'string' && (SPEAKER_WORKFLOW_STATUSES as readonly string[]).includes(value)
  )
}

export const SESSION_CONTENT_STATUSES = ['draft', 'approved'] as const
export type SessionContentStatus = (typeof SESSION_CONTENT_STATUSES)[number]

export function isSessionContentStatus(value: unknown): value is SessionContentStatus {
  return (
    typeof value === 'string' && (SESSION_CONTENT_STATUSES as readonly string[]).includes(value)
  )
}

export const ASSIGNMENT_KINDS = ['general', 'file_request'] as const
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number]

export function isAssignmentKind(value: unknown): value is AssignmentKind {
  return typeof value === 'string' && (ASSIGNMENT_KINDS as readonly string[]).includes(value)
}
