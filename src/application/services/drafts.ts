import type { DraftId, FormId, ProposalDraft } from '../../domain'
import { assertActorCanMutate, assertSubmitterCapability, type SubmitterActor } from '../actors'
import type { DraftDto, SaveDraftInput } from '../dtos/draft.dto'
import { toDraftDto } from '../dtos/draft.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { DraftRepository } from '../ports/draft-repository'
import type { FormRepository } from '../ports/form-repository'
import type { FormVersionRepository } from '../ports/form-version-repository'

export class DraftService {
  readonly #drafts: DraftRepository
  readonly #forms: FormRepository
  readonly #versions: FormVersionRepository
  readonly #clock: Clock

  constructor(
    drafts: DraftRepository,
    forms: FormRepository,
    versions: FormVersionRepository,
    clock: Clock,
  ) {
    this.#drafts = drafts
    this.#forms = forms
    this.#versions = versions
    this.#clock = clock
  }

  /** The actor (contactId + eventId) comes from the persisted submitter session, never the body. */
  async save(actor: SubmitterActor, input: SaveDraftInput): Promise<DraftDto> {
    assertSubmitterCapability(actor, 'cfp')
    assertActorCanMutate(actor)
    if (actor.contactId.trim().length === 0) {
      throw new ValidationFailedError(
        'actor.contactId must be derived from the persisted submitter session',
        [],
      )
    }
    await this.#validateIntakeVersion(actor, input)
    const now = this.#clock.now()
    if (input.id === null) {
      const draft: ProposalDraft = {
        id: crypto.randomUUID(),
        eventId: actor.eventId,
        ownerContactId: actor.contactId,
        formVersionId: input.formVersionId,
        title: input.title,
        answers: input.answers,
        createdAt: now,
        updatedAt: now,
      }
      const saved = await this.#drafts.save(draft, null)
      if (!saved) {
        throw new ApplicationError('conflict', `Draft '${draft.id}' already exists`)
      }
      return toDraftDto(draft)
    }
    const existing = await this.#drafts.findById(input.id)
    if (existing === null) {
      throw new ApplicationError('not_found', `Draft '${input.id}' not found`)
    }
    if (existing.ownerContactId !== actor.contactId || existing.eventId !== actor.eventId) {
      throw new ApplicationError('not_found', `Draft '${input.id}' not found`)
    }
    const updated: ProposalDraft = {
      ...existing,
      title: input.title,
      answers: input.answers,
      formVersionId: input.formVersionId,
      updatedAt: now,
    }
    const saved = await this.#drafts.save(updated, existing.updatedAt)
    if (!saved) {
      throw new ApplicationError('conflict', `Draft '${input.id}' was modified concurrently`)
    }
    return toDraftDto(updated)
  }

  async #validateIntakeVersion(actor: SubmitterActor, input: SaveDraftInput): Promise<void> {
    const version = await this.#versions.findById(input.formVersionId)
    if (version === null) {
      throw new ApplicationError('not_found', `Form version '${input.formVersionId}' not found`)
    }
    if (version.eventId !== actor.eventId || version.formId !== input.formId) {
      throw new ApplicationError('not_found', 'Draft version does not belong to this event/form')
    }
    const form = await this.#forms.findPublicById(version.formId)
    if (form === null || form.eventId !== actor.eventId) {
      throw new ApplicationError('not_found', `Form '${input.formId}' not found`)
    }
    if (form.publishedVersionId !== version.id || version.status !== 'published') {
      throw new ApplicationError(
        'conflict',
        'Only the currently published intake version accepts drafts',
      )
    }
  }

  async get(actor: SubmitterActor, draftId: DraftId): Promise<DraftDto | null> {
    assertSubmitterCapability(actor, 'cfp')
    const draft = await this.#drafts.findById(draftId)
    if (
      draft === null ||
      draft.ownerContactId !== actor.contactId ||
      draft.eventId !== actor.eventId
    ) {
      return null
    }
    return toDraftDto(draft)
  }

  async listByOwner(actor: SubmitterActor): Promise<readonly DraftDto[]> {
    assertSubmitterCapability(actor, 'cfp')
    const drafts = await this.#drafts.listByOwner(actor.eventId, actor.contactId)
    return drafts.map(toDraftDto)
  }

  /**
   * Active draft for the owner + event + form (own-only semantics): the most
   * recently updated draft bound to a version of `formId`, or null.
   */
  async getActiveDraft(actor: SubmitterActor, formId: FormId): Promise<DraftDto | null> {
    assertSubmitterCapability(actor, 'cfp')
    const drafts = await this.#drafts.listByOwner(actor.eventId, actor.contactId)
    const versions = await Promise.all(
      drafts.map((draft) => this.#versions.findById(draft.formVersionId)),
    )
    const candidates: ProposalDraft[] = drafts.filter(
      (_, index) => versions[index]?.formId === formId,
    )
    if (candidates.length === 0) return null
    candidates.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    const active = candidates[0]
    return active === undefined ? null : toDraftDto(active)
  }
}
