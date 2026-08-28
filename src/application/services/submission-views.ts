import { assertActorCanMutate, type OrganizerActor } from '../actors'
import type { SubmissionViewDto, SubmissionViewState } from '../dtos/submission-view.dto'
import {
  MAX_SUBMISSION_VIEW_STATE_LENGTH,
  parseSubmissionViewState,
} from '../dtos/submission-view.dto'
import { ApplicationError } from '../errors'
import type { Clock } from '../ports/clock'
import type { SubmissionViewRepository } from '../ports/submission-view-repository'
import type { EventId } from '../../domain'

export class SubmissionViewService {
  readonly #repository: SubmissionViewRepository
  readonly #clock: Clock
  readonly #id: () => string

  constructor(repository: SubmissionViewRepository, clock: Clock, id: () => string) {
    this.#repository = repository
    this.#clock = clock
    this.#id = id
  }

  async list(_actor: OrganizerActor, eventId: EventId): Promise<readonly SubmissionViewDto[]> {
    return this.#repository.listByEvent(eventId)
  }

  async create(
    actor: OrganizerActor,
    eventId: EventId,
    input: { readonly name: string; readonly state: SubmissionViewState },
  ): Promise<SubmissionViewDto> {
    assertActorCanMutate(actor)
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (name.length === 0 || name.length > 120) {
      throw new ApplicationError(
        'validation_failed',
        'A view name between 1 and 120 characters is required',
      )
    }
    let state: SubmissionViewState
    try {
      state = parseSubmissionViewState(input.state)
    } catch {
      throw new ApplicationError('validation_failed', 'The saved view filters are invalid')
    }
    if (JSON.stringify(state).length > MAX_SUBMISSION_VIEW_STATE_LENGTH) {
      throw new ApplicationError('validation_failed', 'The saved view contains too many filters')
    }
    const now = this.#clock.now()
    const view = {
      eventId,
      id: this.#id(),
      name,
      state,
      createdAt: now,
      updatedAt: now,
    }
    if ((await this.#repository.create(view)) === 'duplicate') {
      throw new ApplicationError('conflict', 'A saved view with that name already exists')
    }
    return view
  }

  async delete(actor: OrganizerActor, eventId: EventId, id: string): Promise<void> {
    assertActorCanMutate(actor)
    if ((await this.#repository.delete(eventId, id)) === 'not-found') {
      throw new ApplicationError('not_found', `Saved view '${id}' not found`)
    }
  }
}
