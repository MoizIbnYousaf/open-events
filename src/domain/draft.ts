import type { AnswerMap } from './answers.ts'
import type { ContactId } from './contact.ts'
import type { EventId, UtcInstant } from './event.ts'
import type { VersionId } from './form-version.ts'

export type DraftId = string

/** Partial proposal draft; multiple drafts per identity are allowed. */
export interface ProposalDraft {
  readonly id: DraftId
  readonly eventId: EventId
  readonly ownerContactId: ContactId
  readonly formVersionId: VersionId
  readonly title: string
  readonly answers: AnswerMap
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
}
