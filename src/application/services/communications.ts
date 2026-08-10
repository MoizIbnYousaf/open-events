import type { CapturedMessage, Event, ProposalSubmission, SubmissionId } from '../../domain'
import { buildCalendarInvite } from '../../domain'
import type { OrganizerActor, SubmitterActor } from '../actors'
import type { AcceptancePreviewDto, CapturedMessageDto } from '../dtos/communication.dto'
import { toCapturedMessageDto } from '../dtos/communication.dto'
import { ApplicationError } from '../errors'
import type { CapturedMessageRepository } from '../ports/captured-message-repository'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { EventRepository } from '../ports/event-repository'
import type { SubmissionRepository } from '../ports/submission-repository'

/** Built-in P0 acceptance template; no per-event template storage yet. */
export const ACCEPTANCE_SUBJECT_TEMPLATE = 'Your proposal "{{title}}" is accepted for {{eventName}}'

export const ACCEPTANCE_BODY_TEMPLATE = [
  'Hi {{speakerName}},',
  '',
  'Great news: your proposal "{{title}}" has been accepted for {{eventName}}.',
  '',
  'A calendar invite for {{eventName}} is attached to this message. Please add it',
  'to your calendar so we know you have the dates.',
  '',
  'Thank you,',
  'The {{eventName}} programme team',
].join('\n')

export interface AcceptanceTemplateVariables {
  readonly speakerName: string
  readonly eventName: string
  readonly title: string
}

/**
 * Substitutes the three supported `{{placeholder}}` tokens. Unknown tokens are
 * left verbatim rather than replaced with `undefined`, so a template typo is
 * visible in the preview instead of silently corrupting the message.
 */
export function renderAcceptanceTemplate(
  template: string,
  variables: AcceptanceTemplateVariables,
): string {
  return template.replace(/\{\{(speakerName|eventName|title)\}\}/g, (_match, key: string) => {
    return variables[key as keyof AcceptanceTemplateVariables]
  })
}

/**
 * Organizer acceptance communications and the owning submitter's calendar
 * invite. Sends are append-only and idempotent: the captured-message log is
 * never mutated or deleted, and a repeat send returns the stored row.
 */
export class CommunicationsService {
  readonly #submissions: SubmissionRepository
  readonly #events: EventRepository
  readonly #contacts: ContactRepository
  readonly #messages: CapturedMessageRepository
  readonly #clock: Clock

  constructor(
    submissions: SubmissionRepository,
    events: EventRepository,
    contacts: ContactRepository,
    messages: CapturedMessageRepository,
    clock: Clock,
  ) {
    this.#submissions = submissions
    this.#events = events
    this.#contacts = contacts
    this.#messages = messages
    this.#clock = clock
  }

  async previewAcceptance(
    _actor: OrganizerActor,
    submissionId: SubmissionId,
  ): Promise<AcceptancePreviewDto> {
    const rendered = await this.#render(submissionId)
    const existing = await this.#messages.findBySubmissionId(submissionId)
    return {
      submissionId,
      toEmail: rendered.toEmail,
      subject: rendered.subject,
      body: rendered.body,
      alreadySent: existing !== null,
    }
  }

  /**
   * Queues the acceptance exactly once per submission. The repository's unique
   * submission constraint is the authority: a concurrent duplicate insert
   * fails and resolves to the row that won.
   */
  async queueAcceptance(
    _actor: OrganizerActor,
    submissionId: SubmissionId,
  ): Promise<CapturedMessageDto> {
    const existing = await this.#messages.findBySubmissionId(submissionId)
    if (existing !== null) return toCapturedMessageDto(existing, submissionId)

    const rendered = await this.#render(submissionId)
    const message: CapturedMessage = {
      id: crypto.randomUUID(),
      eventId: rendered.submission.eventId,
      toEmail: rendered.toEmail,
      subject: rendered.subject,
      body: rendered.body,
      createdAt: this.#clock.now(),
      submissionId,
    }
    try {
      await this.#messages.save(message)
    } catch (error) {
      const winner = await this.#messages.findBySubmissionId(submissionId)
      if (winner === null) throw error
      return toCapturedMessageDto(winner, submissionId)
    }
    return toCapturedMessageDto(message, submissionId)
  }

  async listHistory(
    _actor: OrganizerActor,
    submissionId: SubmissionId,
  ): Promise<readonly CapturedMessageDto[]> {
    await this.#requireSubmission(submissionId)
    const messages = await this.#messages.listBySubmissionId(submissionId)
    return messages.map((message) => toCapturedMessageDto(message, submissionId))
  }

  /**
   * Renders the .ics for the OWNING submitter only; every other actor (a
   * different speaker, another event, an unknown id) gets null so the route
   * answers an indistinguishable 404.
   */
  async buildInvite(actor: SubmitterActor, submissionId: SubmissionId): Promise<string | null> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null) return null
    if (submission.eventId !== actor.eventId || submission.ownerContactId !== actor.contactId) {
      return null
    }
    const event = await this.#requireEvent(submission)
    if (event.dates === null) {
      throw new ApplicationError('conflict', 'Event dates are not configured')
    }
    return buildCalendarInvite({
      submissionId: submission.id,
      title: submission.title,
      startsAt: event.dates.startsAt,
      endsAt: event.dates.endsAt,
      dtstamp: this.#clock.now(),
    })
  }

  async #render(submissionId: SubmissionId): Promise<{
    readonly submission: ProposalSubmission
    readonly toEmail: string
    readonly subject: string
    readonly body: string
  }> {
    const submission = await this.#requireSubmission(submissionId)
    const event = await this.#requireEvent(submission)
    const owner = await this.#contacts.findById(submission.ownerContactId)
    if (owner === null) {
      throw new ApplicationError('not_found', `Owner of submission '${submissionId}' not found`)
    }
    const variables: AcceptanceTemplateVariables = {
      speakerName: owner.name,
      eventName: event.name,
      title: submission.title,
    }
    return {
      submission,
      toEmail: owner.email,
      subject: renderAcceptanceTemplate(ACCEPTANCE_SUBJECT_TEMPLATE, variables),
      body: renderAcceptanceTemplate(ACCEPTANCE_BODY_TEMPLATE, variables),
    }
  }

  async #requireSubmission(submissionId: SubmissionId): Promise<ProposalSubmission> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null) {
      throw new ApplicationError('not_found', `Submission '${submissionId}' not found`)
    }
    return submission
  }

  async #requireEvent(submission: ProposalSubmission): Promise<Event> {
    const event = await this.#events.findById(submission.eventId)
    if (event === null) {
      throw new ApplicationError('not_found', `Event '${submission.eventId}' not found`)
    }
    return event
  }
}
