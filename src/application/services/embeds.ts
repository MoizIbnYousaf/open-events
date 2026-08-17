import type { EventSlug } from '../../domain/event'
import {
  isEmbedFormat,
  isEmbedKind,
  isEmbedPublication,
  type EmbedFormat,
  type EmbedKind,
  type EmbedRecord,
} from '../../domain/embed'
import { assertActorCanMutate, type OrganizerActor } from '../actors'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { EventRepository } from '../ports/event-repository'
import type { ProgrammeRepository } from '../ports/programme-repository'

export interface EmbedDto {
  readonly id: string
  readonly eventId: string
  readonly name: string
  readonly kind: EmbedKind
  readonly format: EmbedFormat
  readonly enabled: boolean
  readonly brandColor: string
  readonly trackFilter: string
  readonly snippet: string
}

export function embedSnippet(origin: string, embed: EmbedRecord): string {
  const href = `${origin.replace(/\/$/, '')}/embed/${embed.id}`
  if (embed.format === 'html') {
    return `<iframe src="${href}" title="${embed.name}" style="width:100%;min-height:480px;border:0"></iframe>`
  }
  return href
}

export function embedPreviewHref(origin: string, embedId: string): string {
  return `${origin.replace(/\/$/, '')}/embed/${embedId}`
}

export class EmbedService {
  readonly #events: EventRepository
  readonly #programme: ProgrammeRepository
  readonly #clock: Clock

  constructor(events: EventRepository, programme: ProgrammeRepository, clock: Clock) {
    this.#events = events
    this.#programme = programme
    this.#clock = clock
  }

  async list(actor: OrganizerActor, slug: EventSlug, origin: string): Promise<readonly EmbedDto[]> {
    void actor
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    const rows = await this.#programme.listEmbeds(event.id)
    return rows
      .filter((row) => isEmbedPublication(row.kind, row.format))
      .map((row) => this.#toDto(row, origin))
  }

  async create(
    actor: OrganizerActor,
    slug: EventSlug,
    input: {
      readonly name: string
      readonly kind: string
      readonly format: string
      readonly brandColor?: string
      readonly trackFilter?: string
      readonly enabled?: boolean
    },
    origin: string,
  ): Promise<EmbedDto> {
    assertActorCanMutate(actor)
    if (
      !isEmbedKind(input.kind) ||
      !isEmbedFormat(input.format) ||
      !isEmbedPublication(input.kind, input.format)
    ) {
      throw new ValidationFailedError('Unsupported publication type or format', [])
    }
    const name = input.name.trim()
    if (name.length === 0) throw new ValidationFailedError('Embed name is required', [])
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', `Event '${slug}' not found`)
    const now = this.#clock.now()
    const record: EmbedRecord = {
      id: crypto.randomUUID(),
      eventId: event.id,
      name,
      kind: input.kind,
      format: input.format,
      enabled: input.enabled ?? true,
      brandColor: input.brandColor?.trim() ?? '',
      trackFilter: input.trackFilter?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    }
    await this.#programme.saveEmbed(record)
    return this.#toDto(record, origin)
  }

  async getPublic(id: string): Promise<EmbedRecord | null> {
    const embed = await this.#programme.findEmbed(id)
    if (embed === null || !embed.enabled || !isEmbedPublication(embed.kind, embed.format)) {
      return null
    }
    return embed
  }

  #toDto(row: EmbedRecord, origin: string): EmbedDto {
    return {
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      kind: row.kind,
      format: row.format,
      enabled: row.enabled,
      brandColor: row.brandColor,
      trackFilter: row.trackFilter,
      snippet: embedSnippet(origin, row),
    }
  }
}
