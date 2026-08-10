import type { ContactId, EventId } from '../../domain'
import type { SubmitterActor } from '../actors'
import { ApplicationError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ObjectStoragePort } from '../ports/object-storage'
import type {
  UploadedFileKind,
  UploadedFileRecord,
  UploadedFileRepository,
} from '../ports/uploaded-file-repository'

/**
 * Frozen supporting-document envelope (REQ-007): an explicit small allow-list
 * and a hard byte bound. Slide decks (pptx/keynote) are deliberately NOT on
 * the list — the product claims "supporting document (PDF or plain text)",
 * nothing more.
 */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'text/plain'] as const
export const DOCUMENT_FILE_NAME_MAX_LENGTH = 200

const DOCUMENT_KIND: UploadedFileKind = 'document'

export class DocumentTooLargeError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Document exceeds the maximum upload size')
    this.name = 'DocumentTooLargeError'
  }
}

export class DocumentEmptyError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Document body is empty')
    this.name = 'DocumentEmptyError'
  }
}

export class DocumentUnsupportedTypeError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Document content type is not supported')
    this.name = 'DocumentUnsupportedTypeError'
  }
}

export class DocumentFileNameError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Document file name is missing or unsafe')
    this.name = 'DocumentFileNameError'
  }
}

/**
 * The single seam every caller passes a client-supplied display name through.
 * The result is a bounded plain label, never a path: separators, traversal,
 * and control characters are rejected outright rather than rewritten, so what
 * the organizer later sees is exactly what was validated.
 */
export function sanitizeDocumentFileName(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > DOCUMENT_FILE_NAME_MAX_LENGTH) return null
  if (trimmed.includes('/') || trimmed.includes('\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null
  return trimmed
}

/** Public metadata of the stored document; never the storage key. */
export interface DocumentDto {
  readonly id: string
  readonly contentType: string
  readonly sizeBytes: number
  readonly fileName: string
  readonly updatedAt: string
}

export interface DocumentContent extends DocumentDto {
  readonly body: ArrayBuffer
}

export interface StoreDocumentInput {
  readonly contentType: string
  readonly bytes: ArrayBuffer
  readonly fileName: string
}

function toDocumentDto(record: UploadedFileRecord): DocumentDto {
  return {
    id: record.id,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    fileName: record.fileName ?? '',
    updatedAt: record.updatedAt,
  }
}

/** Owner-scoped storage key; every segment comes from the session actor. */
export function documentStorageKey(
  eventId: EventId,
  ownerContactId: ContactId,
  id: string,
): string {
  return `events/${eventId}/contacts/${ownerContactId}/document/${id}`
}

/**
 * REQ-007 supporting-document self-service, mirroring the headshot service's
 * validate-before-write, no-orphan replacement discipline. One current
 * document per speaker per event.
 */
export class DocumentService {
  readonly #files: UploadedFileRepository
  readonly #storage: ObjectStoragePort
  readonly #clock: Clock

  constructor(files: UploadedFileRepository, storage: ObjectStoragePort, clock: Clock) {
    this.#files = files
    this.#storage = storage
    this.#clock = clock
  }

  async storeDocument(actor: SubmitterActor, input: StoreDocumentInput): Promise<DocumentDto> {
    if (!DOCUMENT_CONTENT_TYPES.some((allowed) => allowed === input.contentType)) {
      throw new DocumentUnsupportedTypeError()
    }
    const fileName = sanitizeDocumentFileName(input.fileName)
    if (fileName === null) {
      throw new DocumentFileNameError()
    }
    if (input.bytes.byteLength === 0) {
      throw new DocumentEmptyError()
    }
    if (input.bytes.byteLength > DOCUMENT_MAX_BYTES) {
      throw new DocumentTooLargeError()
    }
    const now = this.#clock.now()
    const existing = await this.#files.findOwn(actor.eventId, actor.contactId, DOCUMENT_KIND)
    const id = crypto.randomUUID()
    const storageKey = documentStorageKey(actor.eventId, actor.contactId, id)
    const record: UploadedFileRecord = {
      id,
      eventId: actor.eventId,
      ownerContactId: actor.contactId,
      kind: DOCUMENT_KIND,
      storageKey,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      fileName,
    }
    await this.#storage.put(storageKey, input.bytes, input.contentType)
    try {
      if (existing !== null) {
        const versions = await this.#files.listVersions(
          actor.eventId,
          actor.contactId,
          DOCUMENT_KIND,
        )
        await this.#files.recordVersion({
          id: existing.id,
          eventId: existing.eventId,
          ownerContactId: existing.ownerContactId,
          kind: existing.kind,
          version: versions.length + 1,
          storageKey: existing.storageKey,
          contentType: existing.contentType,
          sizeBytes: existing.sizeBytes,
          fileName: existing.fileName ?? fileName,
          createdAt: existing.updatedAt,
        })
      }
      await this.#files.upsert(record)
    } catch (error) {
      await this.#storage.delete(storageKey)
      throw error instanceof ApplicationError
        ? error
        : new ApplicationError('internal', 'Document metadata write failed')
    }
    return toDocumentDto(record)
  }

  /** Own-only read; another speaker's document is indistinguishable from none. */
  async getOwnDocument(actor: SubmitterActor): Promise<DocumentContent | null> {
    const record = await this.#files.findOwn(actor.eventId, actor.contactId, DOCUMENT_KIND)
    if (record === null) return null
    const object = await this.#storage.get(record.storageKey)
    if (object === null) return null
    return { ...toDocumentDto(record), body: object.body }
  }
}
