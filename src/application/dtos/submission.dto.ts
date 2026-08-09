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

function throwMissingPrimary(submissionId: SubmissionId): never {
  throw new Error(`Submission '${submissionId}' has no primary contributor`)
}
