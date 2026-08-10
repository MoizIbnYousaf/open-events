import { isSubmissionEditable } from '../../domain/invariants/cfp'
import type {
  AnswerMap,
  CfpForm,
  ContactId,
  ContactRole,
  DraftId,
  EventId,
  FormId,
  FormSlug,
  FormVersion,
  ProposalSubmission,
  RoutingOutcome,
  SubmissionId,
  SubmissionOutcome,
  SubmissionStatus,
  UtcInstant,
  VersionId,
  VersionNumber,
} from '../../domain'

export interface ContributorDto {
  readonly contactId: ContactId
  readonly name: string
  readonly email: string
  readonly role: ContactRole
  readonly position: number
}

/** Immutable submission detail (organizer view). */
export interface SubmissionDetailDto {
  readonly id: SubmissionId
  readonly eventId: EventId
  readonly formId: FormId
  readonly formSlug: FormSlug
  readonly versionId: VersionId
  readonly version: VersionNumber
  readonly status: SubmissionStatus
  readonly title: string
  readonly answers: AnswerMap
  readonly routing: RoutingOutcome | null
  readonly contributors: readonly ContributorDto[]
  readonly createdAt: UtcInstant
  readonly submittedAt: UtcInstant
  /**
   * Whether the submitter may still revise this proposal — the server's verdict,
   * so the portal shows or hides its edit affordance without re-deriving a
   * deadline from a clock the write path does not share with it.
   */
  readonly editable: boolean
}

/** Narrow organizer-list row derived from the same persisted submission. */
export interface SubmissionListItemDto {
  readonly id: SubmissionId
  readonly title: string
  readonly status: SubmissionStatus
  readonly formId: FormId
  readonly formSlug: FormSlug
  readonly version: VersionNumber
  readonly routing: RoutingOutcome | null
  readonly primarySpeaker: ContributorDto
  readonly coSpeakerCount: number
  readonly createdAt: UtcInstant
  readonly submittedAt: UtcInstant
  /**
   * Standing programme verdict. `status` stays `pending` for the life of the
   * row (migration 0002); this is the only field the list may print as
   * Accepted / Rejected / Pending review.
   */
  readonly decision: SubmissionOutcome
}

/**
 * Speaker-portal row: the owner's own list item plus the programme's verdict.
 * `status` is pinned to 'pending' for the lifetime of a submission (migration
 * 0002), so the persisted status can never carry the outcome; `decision` is the
 * only field a speaker-facing surface can read a verdict from.
 *
 * `routing` is deliberately absent. It is the ORGANIZER's triage decision —
 * manual_review flags and internal track/tag keys — rendered on the organizer
 * submission list only; this row is a public read by the submitter, so the
 * decision must not travel with it.
 */
export interface OwnSubmissionListItemDto extends Omit<SubmissionListItemDto, 'routing'> {
  readonly accepted: boolean
  /**
   * Whether the calendar invite can actually be rendered right now. The invite
   * route answers 409 for an event with no configured dates, so a surface that
   * offers a download must gate on this and not on `accepted` alone.
   */
  readonly inviteAvailable: boolean
  /**
   * The programme's verdict as the speaker is entitled to see it, and
   * 'pending' while the proposal is still under review — always a word, never
   * null or absent, so no client has to invent a reading for a missing field.
   *
   * `accepted` says the same thing as `decision === 'accepted'` and is kept
   * alongside it because downstream affordances (the invite, the checklist) key
   * off acceptance alone; a rejection has no such affordances and only ever
   * needs saying.
   */
  readonly decision: SubmissionOutcome
  readonly decidedAt: UtcInstant | null
}

/** One entry of the append-only decision trail. */
export interface SubmissionDecisionHistoryDto {
  /** 1-based position in the trail; the highest is the verdict that stands. */
  readonly sequence: number
  readonly decision: 'accepted' | 'rejected'
  readonly decidedBy: string
  readonly decidedAt: UtcInstant
}

/** The standing programme decision, plus every verdict that preceded it. */
export interface SubmissionDecisionDto {
  readonly submissionId: SubmissionId
  readonly eventId: EventId
  readonly decision: SubmissionOutcome
  readonly decidedBy: string | null
  readonly decidedAt: UtcInstant | null
  /** False when the write recorded the verdict that was already standing. */
  readonly changed: boolean
  /** Oldest first. Empty until the first verdict is recorded. */
  readonly history: readonly SubmissionDecisionHistoryDto[]
}

export interface CoSpeakerInput {
  readonly name: string
  readonly email: string
}

export interface SubmitInput {
  readonly originDraftId: DraftId
  readonly formVersionId: VersionId
  readonly title: string
  readonly answers: AnswerMap
  readonly coSpeakers: readonly CoSpeakerInput[]
  /**
   * The owner is never part of the request body; it is passed separately to
   * `SubmitService.submit(actor, input)` from the session, together with the
   * authoritative event. The submission instant comes exclusively from the
   * service clock.
   */
}

export function toSubmissionDetailDto(
  submission: ProposalSubmission,
  form: CfpForm,
  version: FormVersion,
  contributors: readonly ContributorDto[],
  now: UtcInstant,
): SubmissionDetailDto {
  return {
    id: submission.id,
    eventId: submission.eventId,
    formId: form.id,
    formSlug: form.slug,
    versionId: version.id,
    version: version.version,
    status: submission.status,
    title: submission.title,
    answers: submission.answers,
    routing: submission.routing,
    contributors,
    createdAt: submission.createdAt,
    submittedAt: submission.submittedAt,
    editable: isSubmissionEditable(form.limits, now),
  }
}

export function toSubmissionListItemDto(
  submission: ProposalSubmission,
  form: CfpForm,
  version: FormVersion,
  contributors: readonly ContributorDto[],
  decision: SubmissionOutcome = 'pending',
): SubmissionListItemDto {
  const primarySpeaker =
    contributors.find(
      (contributor) => contributor.role === 'primary' && contributor.position === 0,
    ) ?? throwMissingPrimary(submission.id)
  return {
    id: submission.id,
    title: submission.title,
    status: submission.status,
    formId: form.id,
    formSlug: form.slug,
    version: version.version,
    routing: submission.routing,
    primarySpeaker,
    coSpeakerCount: contributors.filter((contributor) => contributor.role === 'co-speaker').length,
    createdAt: submission.createdAt,
    submittedAt: submission.submittedAt,
    decision,
  }
}

/**
 * Projects the organizer row onto the speaker's own row. Every field is named
 * explicitly so this is an allowlist rather than a subtraction: a new organizer
 * field can never reach the public payload by being added upstream.
 */
export function toOwnSubmissionListItemDto(
  item: SubmissionListItemDto,
  decision: SubmissionOutcome,
  decidedAt: UtcInstant | null,
  inviteAvailable: boolean,
): OwnSubmissionListItemDto {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    formId: item.formId,
    formSlug: item.formSlug,
    version: item.version,
    primarySpeaker: item.primarySpeaker,
    coSpeakerCount: item.coSpeakerCount,
    createdAt: item.createdAt,
    submittedAt: item.submittedAt,
    accepted: decision === 'accepted',
    inviteAvailable,
    decision,
    decidedAt,
  }
}

function throwMissingPrimary(submissionId: SubmissionId): never {
  throw new Error(`Submission '${submissionId}' has no primary contributor`)
}
