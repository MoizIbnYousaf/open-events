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
}

/**
 * Speaker-portal row: the owner's own list item plus its acceptance state.
 * `status` is pinned to 'pending' for the lifetime of a submission (migration
 * 0002) because the acceptance record IS the accepted state, so `accepted` is
 * the only way a speaker-facing surface can ever show that decision.
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
  }
}

export function toSubmissionListItemDto(
  submission: ProposalSubmission,
  form: CfpForm,
  version: FormVersion,
  contributors: readonly ContributorDto[],
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
  }
}

/**
 * Projects the organizer row onto the speaker's own row. Every field is named
 * explicitly so this is an allowlist rather than a subtraction: a new organizer
 * field can never reach the public payload by being added upstream.
 */
export function toOwnSubmissionListItemDto(
  item: SubmissionListItemDto,
  accepted: boolean,
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
    accepted,
    inviteAvailable,
  }
}

function throwMissingPrimary(submissionId: SubmissionId): never {
  throw new Error(`Submission '${submissionId}' has no primary contributor`)
}
