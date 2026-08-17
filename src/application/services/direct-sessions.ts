import { SPEAKER_TASK_KINDS, type AnswerMap, type SpeakerTask } from '../../domain'
import { defaultAgendaSlot } from '../../domain/agenda'
import { assertActorCanMutate, type OrganizerActor } from '../actors'
import type { CreateDirectSessionInput, DirectSessionReceiptDto } from '../dtos/direct-session.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ContactRepository } from '../ports/contact-repository'
import type { DirectSessionUnitOfWork } from '../ports/direct-session-unit-of-work'
import type { EventRepository } from '../ports/event-repository'
import type { TaxonomyRepository } from '../ports/taxonomy-repository'
import type { TokenHasher } from '../ports/token-ports'

export class DirectSessionService {
  readonly events: EventRepository
  readonly contacts: ContactRepository
  readonly taxonomies: TaxonomyRepository
  readonly unitOfWork: DirectSessionUnitOfWork
  readonly hasher: TokenHasher
  readonly clock: Clock

  constructor(
    events: EventRepository,
    contacts: ContactRepository,
    taxonomies: TaxonomyRepository,
    unitOfWork: DirectSessionUnitOfWork,
    hasher: TokenHasher,
    clock: Clock,
  ) {
    this.events = events
    this.contacts = contacts
    this.taxonomies = taxonomies
    this.unitOfWork = unitOfWork
    this.hasher = hasher
    this.clock = clock
  }

  async create(
    actor: OrganizerActor,
    eventSlug: string,
    input: CreateDirectSessionInput,
  ): Promise<DirectSessionReceiptDto> {
    assertActorCanMutate(actor)
    const event = await this.events.findBySlug(eventSlug)
    if (event === null) throw new ApplicationError('not_found', 'Event not found')
    const requestId = input.requestId.trim()
    const title = input.title.trim()
    const abstract = input.abstract.trim()
    const notes = input.notes.trim()
    if (requestId.length === 0 || requestId.length > 128) this.invalid('Invalid request identity')
    if (title.length === 0 || title.length > 200) this.invalid('Title must be 1 to 200 characters')
    if (abstract.length === 0 || abstract.length > 5_000) {
      this.invalid('Abstract must be 1 to 5,000 characters')
    }
    if (notes.length > 2_000) this.invalid('Notes are limited to 2,000 characters')
    if (
      !Number.isInteger(input.durationMinutes) ||
      input.durationMinutes < 15 ||
      input.durationMinutes > 240
    ) {
      this.invalid('Duration must be 15 to 240 minutes')
    }
    const [roster, taxonomy] = await Promise.all([
      this.contacts.listSpeakersByEvent(event.id),
      this.taxonomies.listByEvent(event.id),
    ])
    if (!roster.some((speaker) => speaker.contactId === input.speakerContactId)) {
      throw new ApplicationError('not_found', 'Speaker not found')
    }
    const format = taxonomy.find((item) => item.id === input.formatId && item.kind === 'format')
    if (format === undefined) this.invalid('Select a valid session format')
    const track =
      input.trackId === null
        ? null
        : taxonomy.find((item) => item.id === input.trackId && item.kind === 'track')
    if (input.trackId !== null && track === undefined) this.invalid('Select a valid track')

    const now = this.clock.now()
    const base = defaultAgendaSlot(event.dates?.startsAt ?? now)
    const end = new Date(Date.parse(base.start) + input.durationMinutes * 60_000).toISOString()
    const answers: AnswerMap = {
      abstract,
      format: format.label,
      ...(track === null || track === undefined ? {} : { track: track.label }),
      ...(notes === '' ? {} : { notes }),
    }
    const contentHash = await this.hasher.hash(
      JSON.stringify({
        eventId: event.id,
        speakerContactId: input.speakerContactId,
        title,
        answers,
      }),
    )
    const submissionId = crypto.randomUUID()
    const tasks: SpeakerTask[] = SPEAKER_TASK_KINDS.map((kind, position) => ({
      id: crypto.randomUUID(),
      eventId: event.id,
      submissionId,
      contactId: input.speakerContactId,
      kind,
      status: 'pending',
      position,
      createdAt: now,
      completedAt: null,
      formId: null,
      formVersionId: null,
      response: null,
    }))
    const result = await this.unitOfWork.execute({
      eventId: event.id,
      formId: `direct-form-${event.id}`,
      versionId: `direct-version-${event.id}`,
      requestId,
      submissionId,
      speakerContactId: input.speakerContactId,
      title,
      answers,
      contentHash,
      submittedAt: now,
      decisionId: crypto.randomUUID(),
      tasks,
      session: {
        day: base.day,
        start: base.start,
        end,
        trackId: track?.id ?? null,
      },
    })
    if (result.outcome === 'conflict' || result.submissionId === null) {
      throw new ApplicationError(
        'conflict',
        'That direct-session request conflicts with an existing request',
      )
    }
    return { submissionId: result.submissionId, created: result.outcome === 'created' }
  }

  private invalid(message: string): never {
    throw new ValidationFailedError(message, [])
  }
}
