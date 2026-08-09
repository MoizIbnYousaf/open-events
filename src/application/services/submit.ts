import type {
  CapturedMessage,
  CfpForm,
  Contact,
  EventId,
  FormVersion,
  ProposalSubmission,
  SubmissionId,
} from '../../domain'
import {
  applyRoutingRules,
  computeSubmissionContentHash,
  isValidEmailAddress,
  MAX_CO_SPEAKERS,
  normalizeEmail,
  validateAnswersAgainstVersion,
} from '../../domain'
import type {
  ContributorDto,
  SubmissionDetailDto,
  SubmissionListItemDto,
  SubmitInput,
} from '../dtos/submission.dto'
import { toSubmissionDetailDto, toSubmissionListItemDto } from '../dtos/submission.dto'
import type { OrganizerActor, SubmitterActor } from '../actors'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { DraftRepository } from '../ports/draft-repository'
import type { FormContentRepository } from '../ports/form-content-repository'
import type { FormRepository } from '../ports/form-repository'
import type { FormVersionRepository } from '../ports/form-version-repository'
import type { SubmissionRepository } from '../ports/submission-repository'
import type { CoSpeakerIntent, SubmitUnitOfWork } from '../ports/submit-unit-of-work'

export class SubmitService {
  readonly #drafts: DraftRepository
  readonly #submissions: SubmissionRepository
  readonly #contacts: ContactRepository
  readonly #forms: FormRepository
  readonly #versions: FormVersionRepository
  readonly #content: FormContentRepository
  readonly #submitUnitOfWork: SubmitUnitOfWork
  readonly #clock: Clock

  constructor(
    drafts: DraftRepository,
    submissions: SubmissionRepository,
    contacts: ContactRepository,
    forms: FormRepository,
    versions: FormVersionRepository,
    content: FormContentRepository,
    submitUnitOfWork: SubmitUnitOfWork,
    clock: Clock,
  ) {
    this.#drafts = drafts
    this.#submissions = submissions
    this.#contacts = contacts
    this.#forms = forms
    this.#versions = versions
    this.#content = content
    this.#submitUnitOfWork = submitUnitOfWork
    this.#clock = clock
  }

  /**
   * Idempotent submit: retries of the same `originDraftId` return the existing
   * submission. The gate (open/cap/per-identity), answer re-evaluation, and
   * routing all run server-side. Concurrency safety comes from the
   * `SubmitUnitOfWork`: the D1 adapter performs the conditional cap/identity
   * checks and the entire write batch atomically (including unique-origin
   * conflict handling). The early checks in this service are validation only
   * and are NOT a concurrency guarantee. The actor (contactId + eventId) comes
   * from the persisted submitter session, never the request body, and every
   * instant (submittedAt/createdAt/gate) comes from the service clock.
   */
  async submit(actor: SubmitterActor, input: SubmitInput): Promise<SubmissionDetailDto> {
    const now = this.#clock.now()
    if (input.coSpeakers.length > MAX_CO_SPEAKERS) {
      throw new ValidationFailedError(
        `A submission may include at most ${MAX_CO_SPEAKERS} co-speakers`,
        [],
      )
    }
    const existing = await this.#submissions.findByOriginDraftId(input.originDraftId)
    if (existing !== null) {
      if (existing.eventId !== actor.eventId || existing.ownerContactId !== actor.contactId) {
        throw new ApplicationError('not_found', `Draft '${input.originDraftId}' not found`)
      }
      return this.#detail(existing)
    }

    const draft = await this.#drafts.findById(input.originDraftId)
    if (draft === null) {
      throw new ApplicationError('not_found', `Draft '${input.originDraftId}' not found`)
    }
    if (draft.eventId !== actor.eventId || draft.ownerContactId !== actor.contactId) {
      throw new ApplicationError('not_found', `Draft '${input.originDraftId}' not found`)
    }
    if (draft.formVersionId !== input.formVersionId) {
      throw new ApplicationError('conflict', 'Draft belongs to a different form version')
    }
    if (input.title.trim().length === 0) {
      throw new ValidationFailedError('Proposal title is required', [])
    }

    const version = await this.#versions.findById(input.formVersionId)
    if (version === null) {
      throw new ApplicationError('not_found', `Form version '${input.formVersionId}' not found`)
    }
    const form = await this.#forms.findById(version.formId)
    if (form === null || form.eventId !== actor.eventId || version.eventId !== actor.eventId) {
      throw new ApplicationError('not_found', `Form for version '${input.formVersionId}' not found`)
    }

    const content = await this.#content.loadByVersion(actor.eventId, version.id)
    const answerIssues = validateAnswersAgainstVersion(content, input.answers)
    if (answerIssues.length > 0) {
      throw new ValidationFailedError('Answers failed server-side validation', answerIssues)
    }
    const routing = applyRoutingRules(content.routingRules, input.answers)

    const owner = await this.#contacts.findById(actor.contactId)
    if (owner === null) {
      throw new ApplicationError('not_found', 'Owner contact not found')
    }
    const coSpeakers = await this.#resolveCoSpeakers(input, owner)
    const submissionId = crypto.randomUUID()
    const submission: ProposalSubmission = {
      id: submissionId,
      eventId: actor.eventId,
      ownerContactId: actor.contactId,
      formVersionId: version.id,
      originDraftId: input.originDraftId,
      status: 'pending',
      title: input.title,
      answers: input.answers,
      contentHash: await computeSubmissionContentHash(input.title, input.answers, version.id),
      routing,
      createdAt: now,
      submittedAt: now,
    }
    const message: CapturedMessage = {
      id: crypto.randomUUID(),
      eventId: actor.eventId,
      toEmail: owner.email,
      subject: 'Your submission was received',
      body: `SpeakerOps: your submission "${input.title}" was received (${submissionId}).`,
      createdAt: now,
    }
    const confirmation = {
      id: crypto.randomUUID(),
      eventId: actor.eventId,
      submissionId,
      capturedMessageId: message.id,
      createdAt: now,
    }

    const result = await this.#submitUnitOfWork.execute({
      eventId: actor.eventId,
      formId: form.id,
      originDraftId: input.originDraftId,
      ownerContactId: actor.contactId,
      submittedAt: now,
      submission,
      coSpeakers,
      confirmation,
      message,
    })
    switch (result.outcome) {
      case 'inserted':
        return this.#detail(result.submission)
      case 'existing-idempotent': {
        if (
          result.submission.eventId !== actor.eventId ||
          result.submission.ownerContactId !== actor.contactId
        ) {
          throw new ApplicationError('not_found', `Draft '${input.originDraftId}' not found`)
        }
        return this.#detail(result.submission)
      }
      case 'closed':
        throw new ApplicationError('cfp_closed', 'The CFP is not open for submissions')
      case 'capped':
        throw new ApplicationError('cfp_capped', 'The CFP submission cap has been reached')
      case 'identity-limited':
        throw new ApplicationError(
          'identity_limit_reached',
          'The per-identity submission limit has been reached',
        )
    }
  }

  async listByEvent(
    _actor: OrganizerActor,
    eventId: EventId,
  ): Promise<readonly SubmissionListItemDto[]> {
    const submissions = await this.#submissions.listByEvent(eventId)
    const items: SubmissionListItemDto[] = []
    for (const submission of submissions) {
      items.push(await this.#listItem(submission))
    }
    return items
  }

  /** Organizer/event-scoped retrieval: mismatched event returns null (safe 404). */
  async getDetailForEvent(
    _actor: OrganizerActor,
    eventId: EventId,
    id: SubmissionId,
  ): Promise<SubmissionDetailDto | null> {
    const submission = await this.#submissions.findById(id)
    if (submission === null || submission.eventId !== eventId) return null
    return this.#detail(submission)
  }

  /** Submitter-owned retrieval: another actor's submission returns null (safe 404). */
  async getOwnDetail(actor: SubmitterActor, id: SubmissionId): Promise<SubmissionDetailDto | null> {
    const submission = await this.#submissions.findById(id)
    if (
      submission === null ||
      submission.ownerContactId !== actor.contactId ||
      submission.eventId !== actor.eventId
    ) {
      return null
    }
    return this.#detail(submission)
  }

  async #detail(submission: ProposalSubmission): Promise<SubmissionDetailDto> {
    const { form, version, contributors } = await this.#context(submission)
    return toSubmissionDetailDto(submission, form, version, contributors)
  }

  async #listItem(submission: ProposalSubmission): Promise<SubmissionListItemDto> {
    const { form, version, contributors } = await this.#context(submission)
    return toSubmissionListItemDto(submission, form, version, contributors)
  }

  async #context(submission: ProposalSubmission): Promise<{
    readonly form: CfpForm
    readonly version: FormVersion
    readonly contributors: readonly ContributorDto[]
  }> {
    const version = await this.#versions.findById(submission.formVersionId)
    if (version === null) {
      throw new ApplicationError(
        'not_found',
        `Form version '${submission.formVersionId}' not found`,
      )
    }
    const form = await this.#forms.findById(version.formId)
    if (form === null) {
      throw new ApplicationError('not_found', `Form '${version.formId}' not found`)
    }
    const rows = await this.#submissions.listContributorsBySubmission(
      submission.eventId,
      submission.id,
    )
    const contributors: ContributorDto[] = []
    for (const row of rows) {
      const contact = await this.#contacts.findById(row.contactId)
      if (contact === null) {
        throw new ApplicationError('not_found', `Contact '${row.contactId}' not found`)
      }
      contributors.push({
        contactId: contact.id,
        name: contact.name,
        email: contact.email,
        role: row.role,
        position: row.position,
      })
    }
    return { form, version, contributors }
  }

  async #resolveCoSpeakers(input: SubmitInput, owner: Contact): Promise<CoSpeakerIntent[]> {
    const seen = new Set<string>([owner.email])
    const resolved: CoSpeakerIntent[] = []
    for (const coSpeaker of input.coSpeakers) {
      const email = normalizeEmail(coSpeaker.email)
      if (!isValidEmailAddress(email)) {
        throw new ValidationFailedError(`Invalid co-speaker email '${coSpeaker.email}'`, [])
      }
      if (seen.has(email)) {
        throw new ValidationFailedError(
          'Co-speaker emails must be distinct from the primary speaker and from each other',
          [],
        )
      }
      seen.add(email)
      resolved.push({
        email,
        name: coSpeaker.name.trim().length > 0 ? coSpeaker.name.trim() : email,
      })
    }
    return resolved
  }
}
