import type { EventId, TaxonomyItem, TaxonomyItemId, TaxonomyKey, TaxonomyKind } from '../../domain'

export interface TaxonomyItemDto {
  readonly id: TaxonomyItemId
  readonly kind: TaxonomyKind
  readonly key: TaxonomyKey
  readonly label: string
  readonly position: number
}

export interface TaxonomyListDto {
  readonly eventId: EventId
  readonly items: readonly TaxonomyItemDto[]
}

export interface TaxonomyItemInput {
  readonly kind: TaxonomyKind
  readonly key: TaxonomyKey
  readonly label: string
  readonly position: number
}

export interface ReplaceTaxonomyInput {
  readonly items: readonly TaxonomyItemInput[]
}

export function toTaxonomyItemDto(item: TaxonomyItem): TaxonomyItemDto {
  return {
    id: item.id,
    kind: item.kind,
    key: item.key,
    label: item.label,
    position: item.position,
  }
}

export function toTaxonomyListDto(
  eventId: EventId,
  items: readonly TaxonomyItem[],
): TaxonomyListDto {
  return { eventId, items: items.map(toTaxonomyItemDto) }
}
