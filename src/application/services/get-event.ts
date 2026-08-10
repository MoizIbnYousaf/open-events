import type { EventId, EventSlug } from '../../domain'
import type { EventDto } from '../dtos/event-dto'
import { toEventDto } from '../dtos/event-dto'
import type { EventRepository } from '../ports/event-repository'

/** Input for looking up an event by its stable id. */
export interface GetEventInput {
  readonly id: EventId
}

/** Input for looking up an event by its public slug. */
export interface GetEventBySlugInput {
  readonly slug: EventSlug
}

/** Application service that reads a single event through the repository port. */
export class GetEvent {
  readonly #eventRepository: EventRepository

  constructor(eventRepository: EventRepository) {
    this.#eventRepository = eventRepository
  }

  async execute(input: GetEventInput): Promise<EventDto | null> {
    const event = await this.#eventRepository.findById(input.id)
    return event === null ? null : toEventDto(event)
  }

  async executeBySlug(input: GetEventBySlugInput): Promise<EventDto | null> {
    const event = await this.#eventRepository.findBySlug(input.slug)
    return event === null ? null : toEventDto(event)
  }
}
