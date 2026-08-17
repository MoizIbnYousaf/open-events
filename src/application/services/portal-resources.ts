import {
  validatePortalResourceInput,
  type PortalResource,
  type PortalResourceInput,
} from '../../domain'
import {
  assertActorCanMutate,
  assertSubmitterCapability,
  type OrganizerActor,
  type SubmitterActor,
} from '../actors'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { EventRepository } from '../ports/event-repository'
import type { PortalResourceRepository } from '../ports/portal-resource-repository'

export class PortalResourceService {
  readonly resources: PortalResourceRepository
  readonly events: EventRepository
  readonly clock: Clock

  constructor(resources: PortalResourceRepository, events: EventRepository, clock: Clock) {
    this.resources = resources
    this.events = events
    this.clock = clock
  }

  async listOrganizer(_actor: OrganizerActor, slug: string): Promise<readonly PortalResource[]> {
    return this.resources.listByEvent((await this.event(slug)).id)
  }

  async listSpeaker(actor: SubmitterActor): Promise<readonly PortalResource[]> {
    assertSubmitterCapability(actor, 'portal')
    return (await this.resources.listByEvent(actor.eventId)).filter(
      (resource) => resource.published,
    )
  }

  async create(
    actor: OrganizerActor,
    slug: string,
    input: PortalResourceInput & { readonly published: boolean },
  ): Promise<PortalResource> {
    assertActorCanMutate(actor)
    const event = await this.event(slug)
    const content = this.validate(input)
    const now = this.clock.now()
    const existing = await this.resources.listByEvent(event.id)
    const resource: PortalResource = {
      id: crypto.randomUUID(),
      eventId: event.id,
      ...content,
      position: existing.length,
      published: input.published,
      createdAt: now,
      updatedAt: now,
    }
    await this.resources.insert(resource)
    return resource
  }

  async update(
    actor: OrganizerActor,
    slug: string,
    id: string,
    input: PortalResourceInput & { readonly published: boolean },
  ): Promise<PortalResource> {
    assertActorCanMutate(actor)
    const event = await this.event(slug)
    const current = await this.resources.findById(event.id, id)
    if (current === null) throw new ApplicationError('not_found', 'Resource not found')
    const resource: PortalResource = {
      ...current,
      ...this.validate(input),
      published: input.published,
      updatedAt: this.clock.now(),
    }
    if ((await this.resources.update(resource)) === 'not-found') {
      throw new ApplicationError('not_found', 'Resource not found')
    }
    return resource
  }

  async delete(actor: OrganizerActor, slug: string, id: string): Promise<void> {
    assertActorCanMutate(actor)
    const event = await this.event(slug)
    if ((await this.resources.delete(event.id, id)) === 'not-found') {
      throw new ApplicationError('not_found', 'Resource not found')
    }
  }

  async reorder(
    actor: OrganizerActor,
    slug: string,
    ids: readonly string[],
  ): Promise<readonly PortalResource[]> {
    assertActorCanMutate(actor)
    const event = await this.event(slug)
    if (!(await this.resources.reorder(event.id, ids, this.clock.now()))) {
      throw new ApplicationError('conflict', 'Resource order changed; reload and try again')
    }
    return this.resources.listByEvent(event.id)
  }

  private validate(input: PortalResourceInput) {
    try {
      return validatePortalResourceInput(input)
    } catch (error) {
      throw new ValidationFailedError(
        error instanceof Error ? error.message : 'Invalid resource',
        [],
      )
    }
  }

  private async event(slug: string) {
    const event = await this.events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', 'Event not found')
    return event
  }
}
