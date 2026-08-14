import { isAssignmentKind } from '../../domain/embed'
import type { OrganizerActor } from '../actors'
import type { SubmitterActor } from '../actors'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { EventRepository } from '../ports/event-repository'
import type { ProgrammeRepository } from '../ports/programme-repository'

export class AssignmentService {
  readonly #events: EventRepository
  readonly #programme: ProgrammeRepository
  readonly #clock: Clock

  constructor(events: EventRepository, programme: ProgrammeRepository, clock: Clock) {
    this.#events = events
    this.#programme = programme
    this.#clock = clock
  }

  async create(
    _actor: OrganizerActor,
    slug: string,
    input: {
      readonly title: string
      readonly dueAt?: string | null
      readonly kind?: string
      readonly instructions?: string
      readonly contactIds: readonly string[]
    },
  ) {
    const title = input.title.trim()
    if (title.length === 0) throw new ValidationFailedError('Task title is required', [])
    if (input.contactIds.length === 0) {
      throw new ValidationFailedError('Assign the task to at least one speaker', [])
    }
    const kind = input.kind ?? 'general'
    if (!isAssignmentKind(kind)) throw new ValidationFailedError('Unknown task kind', [])
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    const record = {
      id: crypto.randomUUID(),
      eventId: event.id,
      title,
      dueAt: input.dueAt ?? null,
      kind,
      instructions: input.instructions?.trim() ?? '',
      createdAt: this.#clock.now(),
    }
    await this.#programme.saveAssignment(record)
    await this.#programme.setAssignees(
      record.id,
      input.contactIds.map((contactId) => ({
        assignmentId: record.id,
        contactId,
        status: 'pending' as const,
        completedAt: null,
      })),
    )
    return { ...record, contactIds: input.contactIds }
  }

  async list(_actor: OrganizerActor, slug: string) {
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    const assignments = await this.#programme.listAssignments(event.id)
    return Promise.all(
      assignments.map(async (assignment) => ({
        ...assignment,
        assignees: await this.#programme.listAssignees(assignment.id),
      })),
    )
  }

  async listMine(actor: SubmitterActor) {
    return this.#programme.listAssigneesForContact(actor.eventId, actor.contactId)
  }

  async completeMine(actor: SubmitterActor, assignmentId: string) {
    const updated = await this.#programme.completeAssignee(
      assignmentId,
      actor.contactId,
      this.#clock.now(),
    )
    if (updated === 'not-found') {
      throw new ApplicationError('not_found', `Task '${assignmentId}' not found`)
    }
    return { id: assignmentId, status: 'completed' as const }
  }
}
