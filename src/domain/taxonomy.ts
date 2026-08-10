import type { EventId } from './event.ts'

export type TaxonomyItemId = string

/** Stable unique key of a taxonomy item within one event and kind, e.g. 'workshop'. */
export type TaxonomyKey = string

export const TAXONOMY_KINDS = ['format', 'track', 'room', 'level', 'language', 'tag'] as const

export type TaxonomyKind = (typeof TAXONOMY_KINDS)[number]

/** Event-scoped taxonomy vocabulary used for routing and programme display. */
export interface TaxonomyItem {
  readonly id: TaxonomyItemId
  readonly eventId: EventId
  readonly kind: TaxonomyKind
  readonly key: TaxonomyKey
  readonly label: string
  readonly position: number
}
