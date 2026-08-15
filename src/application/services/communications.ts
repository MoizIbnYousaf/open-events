import type { CapturedMessage } from '../../domain/confirmation'
import type { Event, EventId } from '../../domain/event'
import { buildCalendarInvite } from '../../domain/invite'
import type { ProposalSubmission, SubmissionId, SubmissionOutcome } from '../../domain/submission'
import type { OrganizerActor, SubmitterActor } from '../actors'
import type {
  AcceptancePreviewDto,
  AudienceRecipientDto,
  CapturedMessageDto,
} from '../dtos/communication.dto'
import { toCapturedMessageDto } from '../dtos/communication.dto'
import { ApplicationError } from '../errors'
import type { CapturedMessageRepository } from '../ports/captured-message-repository'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { EventRepository } from '../ports/event-repository'
import type { SpeakerTaskRepository } from '../ports/speaker-task-repository'
import type { SubmissionRepository } from '../ports/submission-repository'
import type { ProgrammeRepository } from '../ports/programme-repository'
import {
  CONFIRMATION_BODY_TEMPLATE,
  CONFIRMATION_SUBJECT_TEMPLATE,
} from './confirmation-email'
import { SPEAKER_PORTAL_PATH } from '../public-path'

/** Built-in P0 acceptance template; no per-event template storage yet. */
export const ACCEPTANCE_SUBJECT_TEMPLATE = 'Your proposal "{{title}}" is accepted for {{eventName}}'

/**
 * A CapturedMessage carries a subject and a body and nothing else — there is no
 * attachment field and no transport that could add one — so the body must never
 * claim an attachment. It points at the speaker portal instead, where the
 * generated .ics is a real download next to the onboarding checklist, and it
 * spells the portal's real path out: naming a destination without its address
 * is not a way in.
 */
export const ACCEPTANCE_BODY_TEMPLATE = [
  'Hi {{speakerName}},',
  '',
  'Great news: your proposal "{{title}}" has been accepted for {{eventName}}.',
  '',
  `Open your speaker portal at ${SPEAKER_PORTAL_PATH} to download the calendar invite`,
  'for {{eventName}} and to work through your onboarding checklist.',
  '',
  'Thank you,',
  'The {{eventName}} programme team',
].join('\n')

/** Built-in P0 reminder template: honest nudge, no false claims of novelty. */
export const REMINDER_SUBJECT_TEMPLATE =
  'Reminder: your accepted proposal "{{title}}" for {{eventName}}'

export const REMINDER_BODY_TEMPLATE = [
  'Hi {{speakerName}},',
  '',
  'A quick reminder about your accepted proposal "{{title}}" for {{eventName}}.',
  '',
  `Open your speaker portal at ${SPEAKER_PORTAL_PATH} to finish your onboarding`,
  'checklist and download the calendar invite for {{eventName}}.',
  '',
  'Thank you,',
  'The {{eventName}} programme team',
].join('\n')

export const SPEAKER_WELCOME_SUBJECT_TEMPLATE = 'Welcome to {{eventName}} speakers'

export const SPEAKER_WELCOME_BODY_TEMPLATE = [
  'Hi {{name}},',
  '',
  'Welcome to {{eventName}} speakers.',
  '',
  `Open your speaker portal at {{portalLink}} to finish onboarding.`,
  '',
  'Thank you,',
  'The {{eventName}} programme team',
].join('\n')

export const OUTSTANDING_TASK_SUBJECT_TEMPLATE = 'Reminder: outstanding tasks for {{eventName}}'

export const OUTSTANDING_TASK_BODY_TEMPLATE = [
  'Hi {{name}},',
  '',
  'You still have outstanding speaker tasks for {{eventName}}.',
  '',
  `Open your speaker portal at {{portalLink}} to complete them.`,
  '',
  'Thank you,',
  'The {{eventName}} programme team',
].join('\n')

export interface SpeakerTemplateVariables {
  readonly name: string
  readonly eventName: string
  readonly portalLink: string
}

export function renderSpeakerTemplate(
  template: string,
  variables: SpeakerTemplateVariables,
): string {
  return template.replace(/\{\{(name|eventName|portalLink)\}\}/g, (_match, key: string) => {
    return variables[key as keyof SpeakerTemplateVariables]
  })
}

export const SPEAKER_MAIL_TEMPLATES = [
  {
    id: 'welcome',
    name: 'Welcome',
    subject: SPEAKER_WELCOME_SUBJECT_TEMPLATE,
    body: SPEAKER_WELCOME_BODY_TEMPLATE,
  },
  {
    id: 'outstanding-tasks',
    name: 'Outstanding tasks reminder',
    subject: OUTSTANDING_TASK_SUBJECT_TEMPLATE,
    body: OUTSTANDING_TASK_BODY_TEMPLATE,
  },
] as const

export interface AcceptanceTemplateVariables {
  readonly speakerName: string
  readonly eventName: string
  readonly title: string
}

/** The two organizer-sent kinds; confirmations are captured by public flows. */
export type OrganizerMessageKind = 'acceptance' | 'reminder'

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
 * never mutated or deleted, and a repeat send returns the stored row. The
 * acceptance RECORD is the precondition of the acceptance MESSAGE, so a
 * proposal that was never accepted can never be told that it was.
 */
export class CommunicationsService {
  readonly #submissions: SubmissionRepository
  readonly #events: EventRepository
  readonly #contacts: ContactRepository
  readonly #messages: CapturedMessageRepository
  readonly #acceptances: SpeakerTaskRepository
  readonly #clock: Clock
  readonly #programme: ProgrammeRepository | null

  constructor(
    submissions: SubmissionRepository,
    events: EventRepository,
    contacts: ContactRepository,
    messages: CapturedMessageRepository,
    acceptances: SpeakerTaskRepository,
    clock: Clock,
    programme: ProgrammeRepository | null = null,
  ) {
    this.#submissions = submissions
    this.#events = events
    this.#contacts = contacts
    this.#messages = messages
    this.#acceptances = acceptances
    this.#clock = clock
    this.#programme = programme
  }

  async getConfirmationTemplate(
    _actor: OrganizerActor,
    eventId: EventId,
  ): Promise<{ readonly subject: string; readonly body: string }> {
    const stored =
      this.#programme === null
        ? null
        : await this.#programme.getEmailTemplate(eventId, 'confirmation')
    return {
      subject: stored?.subject ?? CONFIRMATION_SUBJECT_TEMPLATE,
      body: stored?.body ?? CONFIRMATION_BODY_TEMPLATE,
    }
  }

  async saveConfirmationTemplate(
    _actor: OrganizerActor,
    eventId: EventId,
    input: { readonly subject: string; readonly body: string },
  ): Promise<{ readonly subject: string; readonly body: string }> {
    const subject = input.subject.trim()
    const body = input.body.trim()
    if (subject.length === 0 || body.length === 0) {
      throw new ApplicationError('validation_failed', 'Confirmation subject and body are required')
    }
    if (this.#programme === null) {
      throw new ApplicationError('not_found', 'Confirmation templates are not available')
    }
    await this.#programme.saveEmailTemplate(eventId, 'confirmation', subject, body)
    return { subject, body }
  }

  async previewAcceptance(
    actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<AcceptancePreviewDto> {
    return this.#preview(actor, eventId, submissionId, 'acceptance')
  }

  async previewReminder(
    actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<AcceptancePreviewDto> {
    return this.#preview(actor, eventId, submissionId, 'reminder')
  }

  /**
   * Queues the acceptance exactly once per recipient, and only for a
   * submission that really has been accepted. The repository's unique
   * (submission, kind, recipient) constraint is the authority for the
   * once-only part: a concurrent duplicate insert fails and resolves to the
   * row that won.
   */
  async queueAcceptance(
    actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly CapturedMessageDto[]> {
    return this.#queue(actor, eventId, submissionId, 'acceptance')
  }

  async queueReminder(
    actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly CapturedMessageDto[]> {
    return this.#queue(actor, eventId, submissionId, 'reminder')
  }

  async #preview(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
    kind: OrganizerMessageKind,
  ): Promise<AcceptancePreviewDto> {
    const rendered = await this.#render(eventId, submissionId, kind)
    const audience = await this.#audience(rendered.submission, kind)
    return {
      submissionId,
      kind,
      toEmail: rendered.toEmail,
      subject: rendered.subject,
      body: rendered.body,
      accepted: await this.#isAccepted(rendered.submission),
      decision: await this.#standingDecision(rendered.submission),
      alreadySent: audience.length > 0 && audience.every((recipient) => recipient.alreadySent),
      audience,
    }
  }

  async #queue(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
    kind: OrganizerMessageKind,
  ): Promise<readonly CapturedMessageDto[]> {
    const rendered = await this.#render(eventId, submissionId, kind)
    // The STANDING decision, not the acceptance record. Both templates state
    // outright that the proposal is accepted, and a rejection deliberately
    // leaves the acceptance row in place, so gating on that row would announce
    // an acceptance to somebody who has just been rejected. Undecided is
    // refused by the same comparison: nothing has been decided to announce.
    if ((await this.#standingDecision(rendered.submission)) !== 'accepted') {
      throw new ApplicationError(
        'conflict',
        `Submission '${submissionId}' has not been accepted yet`,
      )
    }
    const audience = await this.#audience(rendered.submission, kind)
    return Promise.all(
      audience.map(async (recipient): Promise<CapturedMessageDto> => {
        const message: CapturedMessage = {
          id: crypto.randomUUID(),
          eventId: rendered.submission.eventId,
          toEmail: recipient.email,
          subject: rendered.subject,
          body: rendered.body,
          createdAt: this.#clock.now(),
          kind,
          submissionId,
        }
        try {
          await this.#messages.save(message)
          return toCapturedMessageDto(message, submissionId)
        } catch (error) {
          const winner = await this.#messages.findBySubmissionKindEmail(
            submissionId,
            kind,
            recipient.email,
          )
          if (winner === null) throw error
          return toCapturedMessageDto(winner, submissionId)
        }
      }),
    )
  }

  /**
   * Owner plus actual submission contributors, projected to normalized
   * (trimmed, lowercased) emails, deduped with the owner first. Per-recipient
   * `alreadySent` reads the stored log so the preview names exactly what a
   * send would (re)deliver.
   */
  async #audience(
    submission: ProposalSubmission,
    kind: OrganizerMessageKind,
  ): Promise<readonly AudienceRecipientDto[]> {
    const [owner, contributors] = await Promise.all([
      this.#contacts.findById(submission.ownerContactId),
      this.#submissions.listContributorsBySubmission(submission.eventId, submission.id),
    ])
    const emails: string[] = []
    const seen = new Set<string>()
    const push = (email: string | undefined) => {
      if (email === undefined) return
      const normalized = email.trim().toLowerCase()
      if (normalized.length === 0 || seen.has(normalized)) return
      seen.add(normalized)
      emails.push(normalized)
    }
    push(owner?.email)
    const orderedContributors = contributors.toSorted((a, b) => a.position - b.position)
    const contributorContacts = await Promise.all(
      orderedContributors.map((contributor) => this.#contacts.findById(contributor.contactId)),
    )
    for (const contact of contributorContacts) {
      push(contact?.email)
    }
    return Promise.all(
      emails.map(async (email): Promise<AudienceRecipientDto> => {
        const stored = await this.#messages.findBySubmissionKindEmail(submission.id, kind, email)
        return { email, alreadySent: stored !== null }
      }),
    )
  }

  async listHistory(
    _actor: OrganizerActor,
    eventId: EventId,
    submissionId: SubmissionId,
  ): Promise<readonly CapturedMessageDto[]> {
    await this.#requireSubmission(submissionId, eventId)
    const messages = await this.#messages.listBySubmissionId(submissionId)
    return messages.map((message) => toCapturedMessageDto(message, submissionId))
  }

  speakerMailTemplates(): typeof SPEAKER_MAIL_TEMPLATES {
    return SPEAKER_MAIL_TEMPLATES
  }

  async previewSpeakerBroadcast(
    _actor: OrganizerActor,
    eventId: EventId,
    input: {
      readonly subject: string
      readonly body: string
      readonly contactIds: readonly string[]
    },
  ) {
    const event = await this.#events.findById(eventId)
    if (event === null) throw new ApplicationError('not_found', `Event '${eventId}' not found`)
    const roster = await this.#contacts.listSpeakersByEvent(eventId)
    const chosen =
      input.contactIds.length === 0
        ? roster
        : roster.filter((person) => input.contactIds.includes(person.contactId))
    const sample = chosen[0]
    const variables: SpeakerTemplateVariables = {
      name: sample?.name || 'Speaker',
      eventName: event.name,
      portalLink: SPEAKER_PORTAL_PATH,
    }
    return {
      subject: renderSpeakerTemplate(input.subject, variables),
      body: renderSpeakerTemplate(input.body, variables),
      recipientCount: chosen.length,
      recipients: chosen.map((person) => ({
        contactId: person.contactId,
        name: person.name,
        email: person.email,
      })),
    }
  }

  async sendSpeakerBroadcast(
    _actor: OrganizerActor,
    eventId: EventId,
    input: {
      readonly subject: string
      readonly body: string
      readonly contactIds: readonly string[]
    },
  ) {
    const event = await this.#events.findById(eventId)
    if (event === null) throw new ApplicationError('not_found', `Event '${eventId}' not found`)
    const roster = await this.#contacts.listSpeakersByEvent(eventId)
    const chosen =
      input.contactIds.length === 0
        ? roster
        : roster.filter((person) => input.contactIds.includes(person.contactId))
    if (chosen.length === 0) {
      throw new ApplicationError('validation_failed', 'Select at least one speaker')
    }
    const now = this.#clock.now()
    const messages: CapturedMessage[] = []
    for (const person of chosen) {
      const variables: SpeakerTemplateVariables = {
        name: person.name || person.email,
        eventName: event.name,
        portalLink: SPEAKER_PORTAL_PATH,
      }
      const message: CapturedMessage = {
        id: crypto.randomUUID(),
        eventId,
        toEmail: person.email,
        subject: renderSpeakerTemplate(input.subject, variables),
        body: renderSpeakerTemplate(input.body, variables),
        createdAt: now,
        kind: 'reminder',
      }
      await this.#messages.save(message)
      messages.push(message)
    }
    return {
      sent: messages.length,
      messages: messages.map((message) => ({
        toEmail: message.toEmail,
        subject: message.subject,
        createdAt: message.createdAt,
      })),
    }
  }

  /**
   * Renders the .ics for the OWNING submitter of an ACCEPTED proposal only;
   * every other actor (a different speaker, another event, an unknown id) gets
   * null so the route answers an indistinguishable 404.
   *
   * The verdict gate is not decoration. Ownership alone let a speaker whose
   * proposal was rejected — or never decided at all — download a real calendar
   * hold for an event that had turned them down, and a saved .ics keeps
   * claiming that appointment long after any screen would have corrected it.
   * Undecided is refused for the same reason as rejected: there is nothing yet
   * to put in a diary.
   */
  async buildInvite(actor: SubmitterActor, submissionId: SubmissionId): Promise<string | null> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null) return null
    if (submission.eventId !== actor.eventId || submission.ownerContactId !== actor.contactId) {
      return null
    }
    if ((await this.#standingDecision(submission)) !== 'accepted') return null
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

  /**
   * Whether an invite can be rendered at all for the actor's event. `buildInvite`
   * throws `conflict` for a dateless event, and a `download` link would save
   * that error envelope to disk as the .ics — so speaker-facing surfaces read
   * this first and offer no link they cannot honour. An unknown event is not
   * available rather than an error: this is a presentation fact, not a gate.
   */
  async isInviteAvailable(actor: SubmitterActor): Promise<boolean> {
    const event = await this.#events.findById(actor.eventId)
    return event !== null && event.dates !== null
  }

  async #render(
    eventId: EventId,
    submissionId: SubmissionId,
    kind: OrganizerMessageKind,
  ): Promise<{
    readonly submission: ProposalSubmission
    readonly toEmail: string
    readonly subject: string
    readonly body: string
  }> {
    const submission = await this.#requireSubmission(submissionId, eventId)
    const [event, owner] = await Promise.all([
      this.#requireEvent(submission),
      this.#contacts.findById(submission.ownerContactId),
    ])
    if (owner === null) {
      throw new ApplicationError('not_found', `Owner of submission '${submissionId}' not found`)
    }
    const variables: AcceptanceTemplateVariables = {
      speakerName: owner.name,
      eventName: event.name,
      title: submission.title,
    }
    const subjectTemplate =
      kind === 'acceptance' ? ACCEPTANCE_SUBJECT_TEMPLATE : REMINDER_SUBJECT_TEMPLATE
    const bodyTemplate = kind === 'acceptance' ? ACCEPTANCE_BODY_TEMPLATE : REMINDER_BODY_TEMPLATE
    return {
      submission,
      toEmail: owner.email.trim().toLowerCase(),
      subject: renderAcceptanceTemplate(subjectTemplate, variables),
      body: renderAcceptanceTemplate(bodyTemplate, variables),
    }
  }

  async #isAccepted(submission: ProposalSubmission): Promise<boolean> {
    return (await this.#acceptances.findAcceptance(submission.eventId, submission.id)) !== null
  }

  /**
   * The standing verdict on one submission: 'pending' while nobody has ruled.
   *
   * The decision record is the authority. Where there is none, an ACCEPTANCE
   * RECORD still means accepted — the same fallback migration 0016 applies when
   * it backfills a verdict for every acceptance that predates the table, and
   * the same one the speaker's own portal reads through `listOwnDecisions`.
   *
   * Without this fallback the two surfaces disagreed about the same proposal.
   * `accept()` and `decide()` are two separate writes (the accept route makes
   * both), so a failure between them leaves an acceptance with no decision — a
   * speaker who genuinely was accepted, with a materialised checklist and an
   * agenda session to prove it. Reading that as undecided showed them an
   * "Accepted" badge beside an invite link that answered 404. Deriving both
   * from one rule is what makes the badge and the download agree.
   */
  async #standingDecision(submission: ProposalSubmission): Promise<SubmissionOutcome> {
    const decision = await this.#submissions.findDecision(submission.eventId, submission.id)
    if (decision !== null) return decision.outcome
    return (await this.#isAccepted(submission)) ? 'accepted' : 'pending'
  }

  async #requireSubmission(
    submissionId: SubmissionId,
    eventId: EventId,
  ): Promise<ProposalSubmission> {
    const submission = await this.#submissions.findById(submissionId)
    if (submission === null || submission.eventId !== eventId) {
      // Cross-event and absent are deliberately the same safe answer.
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
