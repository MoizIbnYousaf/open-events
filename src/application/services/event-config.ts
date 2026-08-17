import type { Event, EventSlug } from '../../domain/event'
import { slugifyEventName, uniqueEventSlug } from '../../domain/event-slug'
import { validateEventConfig } from '../../domain/invariants/event'
import { assertActorCanMutate, type OrganizerActor } from '../actors'
import type { AdminEventConfigDto, UpdateEventConfigInput } from '../dtos/event-config.dto'
import { toAdminEventConfigDto } from '../dtos/event-config.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { EventConfigRepository } from '../ports/event-config-repository'

export interface CreateEventInput {
  readonly name: string
  readonly timezone?: string
  readonly startsAt?: string | null
  readonly endsAt?: string | null
}

export class EventConfigService {
  readonly #events: EventConfigRepository
  readonly #clock: Clock

  constructor(events: EventConfigRepository, clock: Clock) {
    this.#events = events
    this.#clock = clock
  }

  async list(actor: OrganizerActor): Promise<readonly AdminEventConfigDto[]> {
    void actor
    const events = await this.#events.list()
    return events.map(toAdminEventConfigDto)
  }

  async create(actor: OrganizerActor, input: CreateEventInput): Promise<AdminEventConfigDto> {
    assertActorCanMutate(actor)
    const name = input.name.trim()
    if (name.length === 0) {
      throw new ValidationFailedError('Event name is required', [
        { code: 'invalid_timezone', message: 'Event name is required' },
      ])
    }
    const existing = await this.#events.list()
    const taken = new Set(existing.map((event) => event.slug))
    const slug = uniqueEventSlug(slugifyEventName(name), taken)
    const startsAt = input.startsAt ?? null
    const endsAt = input.endsAt ?? null
    const created: Event = {
      id: crypto.randomUUID(),
      slug,
      name,
      timezone: input.timezone?.trim() || 'Europe/Berlin',
      status: 'draft',
      dates: startsAt !== null && endsAt !== null ? { startsAt, endsAt } : null,
    }
    const issues = validateEventConfig(created)
    if (issues.length > 0) {
      throw new ValidationFailedError(`Invalid event configuration for '${slug}'`, issues)
    }
    await this.#events.save(created)
    void this.#clock
    return toAdminEventConfigDto(created)
  }

  async getBySlug(_actor: OrganizerActor, slug: EventSlug): Promise<AdminEventConfigDto | null> {
    const event = await this.#events.findBySlug(slug)
    return event === null ? null : toAdminEventConfigDto(event)
  }

  async updateBySlug(
    actor: OrganizerActor,
    slug: EventSlug,
    input: UpdateEventConfigInput,
  ): Promise<AdminEventConfigDto> {
    assertActorCanMutate(actor)
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
