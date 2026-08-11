import type { EventSlug } from '../../domain/event'
import { validateTaxonomyItems } from '../../domain/invariants/taxonomy'
import type { TaxonomyItem } from '../../domain/taxonomy'
import type { OrganizerActor } from '../actors'
import type { ReplaceTaxonomyInput, TaxonomyListDto } from '../dtos/taxonomy.dto'
import { toTaxonomyListDto } from '../dtos/taxonomy.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { EventRepository } from '../ports/event-repository'
import type { TaxonomyRepository } from '../ports/taxonomy-repository'

export class TaxonomyService {
  readonly #events: EventRepository
  readonly #taxonomies: TaxonomyRepository

  constructor(events: EventRepository, taxonomies: TaxonomyRepository) {
    this.#events = events
    this.#taxonomies = taxonomies
  }

  async getByEventSlug(_actor: OrganizerActor, slug: EventSlug): Promise<TaxonomyListDto | null> {
    const event = await this.#events.findBySlug(slug)
    if (event === null) return null
    const items = await this.#taxonomies.listByEvent(event.id)
    return toTaxonomyListDto(event.id, items)
  }

  async replaceByEventSlug(
    _actor: OrganizerActor,
    slug: EventSlug,
    input: ReplaceTaxonomyInput,
  ): Promise<TaxonomyListDto> {
    const event = await this.#events.findBySlug(slug)
    if (event === null) {
      throw new ApplicationError('not_found', `Event '${slug}' not found`)
    }
    const items: TaxonomyItem[] = input.items.map((item) => ({
      id: crypto.randomUUID(),
      eventId: event.id,
      kind: item.kind,
      key: item.key,
      label: item.label,
      position: item.position,
    }))
    const issues = validateTaxonomyItems(items)
    if (issues.length > 0) {
      throw new ValidationFailedError(`Invalid taxonomy items for event '${slug}'`, issues)
    }
    await this.#taxonomies.replaceForEvent(event.id, items)
    return toTaxonomyListDto(event.id, items)
  }
}
