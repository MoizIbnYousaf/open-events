import type { Event, EventSlug } from '../../domain/event'
import { validateEventConfig } from '../../domain/invariants/event'
import type { OrganizerActor } from '../actors'
import type { AdminEventConfigDto, UpdateEventConfigInput } from '../dtos/event-config.dto'
import { toAdminEventConfigDto } from '../dtos/event-config.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { EventConfigRepository } from '../ports/event-config-repository'

export class EventConfigService {
  readonly #events: EventConfigRepository

  constructor(events: EventConfigRepository) {
    this.#events = events
  }

  async getBySlug(_actor: OrganizerActor, slug: EventSlug): Promise<AdminEventConfigDto | null> {
    const event = await this.#events.findBySlug(slug)
    return event === null ? null : toAdminEventConfigDto(event)
  }

  async updateBySlug(
    _actor: OrganizerActor,
    slug: EventSlug,
    input: UpdateEventConfigInput,
  ): Promise<AdminEventConfigDto> {
    const event = await this.#events.findBySlug(slug)
    if (event === null) {
      throw new ApplicationError('not_found', `Event '${slug}' not found`)
    }
    const updated: Event = {
      id: event.id,
      slug: event.slug,
      name: input.name ?? event.name,
      timezone: input.timezone ?? event.timezone,
      status: input.status ?? event.status,
      dates: input.dates !== undefined ? input.dates : event.dates,
      websiteUrl: input.websiteUrl !== undefined ? input.websiteUrl : (event.websiteUrl ?? null),
      organizerContact:
        input.organizerContact !== undefined
          ? input.organizerContact
          : (event.organizerContact ?? null),
      venue: input.venue !== undefined ? input.venue : (event.venue ?? null),
      eventType: input.eventType !== undefined ? input.eventType : (event.eventType ?? null),
    }
    const issues = validateEventConfig(updated)
    if (issues.length > 0) {
      throw new ValidationFailedError(`Invalid event configuration for '${slug}'`, issues)
    }
    await this.#events.save(updated)
    return toAdminEventConfigDto(updated)
  }
}
