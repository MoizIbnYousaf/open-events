import type { ContactId, EventId } from '../../domain'
import type { SubmitterActor } from '../actors'
import type { HeadshotDto } from '../dtos/headshot.dto'
import { toHeadshotDto } from '../dtos/headshot.dto'
import { ApplicationError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ObjectStoragePort } from '../ports/object-storage'
import type {
  UploadedFileKind,
  UploadedFileRecord,
  UploadedFileRepository,
} from '../ports/uploaded-file-repository'

/** Frozen upload envelope: 2 MiB of a small set of raster image types. */
export const HEADSHOT_MAX_BYTES = 2 * 1024 * 1024
export const HEADSHOT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

const HEADSHOT_KIND: UploadedFileKind = 'headshot'

/** Oversize upload; the API layer maps this to 413 with the safe envelope. */
export class HeadshotTooLargeError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Headshot exceeds the maximum upload size')
    this.name = 'HeadshotTooLargeError'
  }
}

/** Empty body; the API layer maps this to 400 — an empty file is not oversize. */
export class HeadshotEmptyError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Headshot body is empty')
    this.name = 'HeadshotEmptyError'
  }
}

/** Unsupported media type; the API layer maps this to 415. */
export class HeadshotUnsupportedTypeError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Headshot content type is not supported')
    this.name = 'HeadshotUnsupportedTypeError'
  }
}

export interface StoreHeadshotInput {
  readonly contentType: string
  readonly bytes: ArrayBuffer
}

/** Own headshot bytes plus the metadata needed to serve them. */
export interface HeadshotContent extends HeadshotDto {
  readonly body: ArrayBuffer
}

/**
 * Owner-scoped storage key. Every segment comes from the persisted session
 * actor plus a fresh id, so a client can never influence the key and a
 * replacement never reuses the superseded object's key.
 */
export function headshotStorageKey(
  eventId: EventId,
  ownerContactId: ContactId,
  id: string,
): string {
  return `events/${eventId}/contacts/${ownerContactId}/headshot/${id}`
}

export class HeadshotService {
  readonly #files: UploadedFileRepository
  readonly #storage: ObjectStoragePort
  readonly #clock: Clock

  constructor(files: UploadedFileRepository, storage: ObjectStoragePort, clock: Clock) {
    this.#files = files
    this.#storage = storage
    this.#clock = clock
  }

  /**
   * Validates size and type BEFORE touching storage, so a denied upload
   * performs zero object writes and zero metadata writes. When the metadata
   * write fails the freshly written object is deleted again, so a failed
   * upload never leaves an orphan behind.
   */
  async storeHeadshot(actor: SubmitterActor, input: StoreHeadshotInput): Promise<HeadshotDto> {
    if (!HEADSHOT_CONTENT_TYPES.some((allowed) => allowed === input.contentType)) {
      throw new HeadshotUnsupportedTypeError()
    }
    if (input.bytes.byteLength === 0) {
      throw new HeadshotEmptyError()
    }
    if (input.bytes.byteLength > HEADSHOT_MAX_BYTES) {
      throw new HeadshotTooLargeError()
    }
    const now = this.#clock.now()
    const existing = await this.#files.findOwn(actor.eventId, actor.contactId, HEADSHOT_KIND)
    const id = crypto.randomUUID()
    const storageKey = headshotStorageKey(actor.eventId, actor.contactId, id)
    const record: UploadedFileRecord = {
      id,
      eventId: actor.eventId,
      ownerContactId: actor.contactId,
      kind: HEADSHOT_KIND,
      storageKey,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    await this.#storage.put(storageKey, input.bytes, input.contentType)
    let previous: UploadedFileRecord | null
    try {
      previous = await this.#files.upsert(record)
    } catch (error) {
      await this.#storage.delete(storageKey)
      throw error instanceof ApplicationError
        ? error
        : new ApplicationError('internal', 'Headshot metadata write failed')
    }
    if (previous !== null && previous.storageKey !== storageKey) {
      await this.#storage.delete(previous.storageKey)
    }
    return toHeadshotDto(record)
  }

  /**
   * Own-only read: the lookup is keyed by the session actor, so another
   * submitter's headshot is indistinguishable from "no headshot" (null ->
   * 404 at the API layer).
   */
  async getOwnHeadshot(actor: SubmitterActor): Promise<HeadshotContent | null> {
    const record = await this.#files.findOwn(actor.eventId, actor.contactId, HEADSHOT_KIND)
    if (record === null) return null
    const object = await this.#storage.get(record.storageKey)
    if (object === null) return null
    return { ...toHeadshotDto(record), body: object.body }
  }
}
