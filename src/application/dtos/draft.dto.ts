import type {
  AnswerMap,
  DraftId,
  EventId,
  FormId,
  ProposalDraft,
  UtcInstant,
  VersionId,
} from '../../domain'

export interface DraftDto {
  readonly id: DraftId
  readonly eventId: EventId
  readonly formVersionId: VersionId
  readonly title: string
  readonly answers: AnswerMap
  readonly updatedAt: UtcInstant
}

/**
 * Save/resume draft body; `id: null` creates a new draft. `ownerContactId`
 * is never part of the request body; it is passed separately to
 * `DraftService.save(actor, input)` from the persisted submitter session,
 * together with the authoritative event. `formId` is required so the intake
 * version can be validated.
 */
export interface SaveDraftInput {
  readonly id: DraftId | null
  readonly formId: FormId
  readonly formVersionId: VersionId
  readonly title: string
  readonly answers: AnswerMap
}

export function toDraftDto(draft: ProposalDraft): DraftDto {
  return {
    id: draft.id,
    eventId: draft.eventId,
    formVersionId: draft.formVersionId,
    title: draft.title,
    answers: draft.answers,
    updatedAt: draft.updatedAt,
  }
}
