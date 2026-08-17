import { describe, expect, it } from 'vitest'

import { GetEvent, type EventDto } from '../../../src/application'
import type { EventRepository } from '../../../src/application/ports/event-repository'
import type { Event, EventId, EventSlug } from '../../../src/domain'

const event: Event = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: 'demo-conf-2026',
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  dates: {
    startsAt: '2026-05-13T08:00:00.000Z',
    endsAt: '2026-05-15T17:00:00.000Z',
  },
}

const expectedDto: EventDto = {
  id: event.id,
  slug: event.slug,
  name: event.name,
  timezone: event.timezone,
  status: event.status,
  startsAt: '2026-05-13T08:00:00.000Z',
  endsAt: '2026-05-15T17:00:00.000Z',
  logoUrl: null,
  logoWidth: null,
  logoHeight: null,
  logoUpdatedAt: null,
  backgroundUrl: null,
  backgroundWidth: null,
  backgroundHeight: null,
  backgroundUpdatedAt: null,
}

/** In-memory implementation of the frozen repository port for unit tests. */
class InMemoryEventRepository implements EventRepository {
  readonly #events: readonly Event[]

  constructor(events: readonly Event[] = []) {
    this.#events = events
  }

  async findById(id: EventId): Promise<Event | null> {
    return this.#events.find((candidate) => candidate.id === id) ?? null
  }

  async findBySlug(slug: EventSlug): Promise<Event | null> {
    return this.#events.find((candidate) => candidate.slug === slug) ?? null
  }

  async list(): Promise<readonly Event[]> {
    return this.#events
  }
}

/** Records the exact keys the service asks the port for. */
class RecordingEventRepository implements EventRepository {
  readonly #delegate: EventRepository
  readonly findByIdCalls: EventId[] = []
  readonly findBySlugCalls: EventSlug[] = []

  constructor(delegate: EventRepository) {
    this.#delegate = delegate
  }

  async findById(id: EventId): Promise<Event | null> {
    this.findByIdCalls.push(id)
    return this.#delegate.findById(id)
  }

  async findBySlug(slug: EventSlug): Promise<Event | null> {
    this.findBySlugCalls.push(slug)
    return this.#delegate.findBySlug(slug)
  }

  async list(): Promise<readonly Event[]> {
    return this.#delegate.list()
  }
}

describe('GetEvent', () => {
  it('returns the mapped DTO when the id exists', async () => {
    const getEvent = new GetEvent(new InMemoryEventRepository([event]))

    await expect(getEvent.execute({ id: event.id })).resolves.toEqual(expectedDto)
  })

  it('returns null when no event matches the id', async () => {
    const getEvent = new GetEvent(new InMemoryEventRepository([event]))

    await expect(
      getEvent.execute({ id: '00000000-0000-0000-0000-000000000000' }),
    ).resolves.toBeNull()
  })

  it('returns the mapped DTO when the slug exists', async () => {
    const getEvent = new GetEvent(new InMemoryEventRepository([event]))

    await expect(getEvent.executeBySlug({ slug: event.slug })).resolves.toEqual(expectedDto)
  })

  it('returns null when no event matches the slug', async () => {
    const getEvent = new GetEvent(new InMemoryEventRepository([event]))

    await expect(getEvent.executeBySlug({ slug: 'unknown-conf' })).resolves.toBeNull()
  })

  it('delegates lookups to the repository port with the exact key', async () => {
    const repository = new RecordingEventRepository(new InMemoryEventRepository([event]))
    const getEvent = new GetEvent(repository)

    await getEvent.execute({ id: event.id })
    await getEvent.executeBySlug({ slug: event.slug })

    expect(repository.findByIdCalls).toEqual([event.id])
    expect(repository.findBySlugCalls).toEqual([event.slug])
  })
})
