import type { ContactId, EventId } from '../../domain'
import { assertActorCanMutate, assertSubmitterCapability, type SubmitterActor } from '../actors'
import { ApplicationError } from '../errors'
import type { Clock } from '../ports/clock'
import type { ObjectStoragePort } from '../ports/object-storage'
import type {
  UploadedFileKind,
  UploadedFileRecord,
  UploadedFileRepository,
} from '../ports/uploaded-file-repository'

/** Supporting material remains download-only and is bounded before R2 writes. */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'text/plain',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.apple.keynote',
  'application/vnd.oasis.opendocument.presentation',
] as const
export const DOCUMENT_FILE_NAME_MAX_LENGTH = 200

type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number]
type DocumentContainer = 'pdf' | 'text' | 'ole' | 'zip'

const DOCUMENT_POLICIES: Readonly<
  Record<
    DocumentContentType,
    { readonly extensions: readonly string[]; readonly container: DocumentContainer }
  >
> = {
  'application/pdf': { extensions: ['pdf'], container: 'pdf' },
  'text/plain': { extensions: ['txt'], container: 'text' },
  'application/vnd.ms-powerpoint': { extensions: ['ppt'], container: 'ole' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    extensions: ['pptx'],
    container: 'zip',
  },
  'application/vnd.apple.keynote': { extensions: ['key'], container: 'zip' },
  'application/vnd.oasis.opendocument.presentation': { extensions: ['odp'], container: 'zip' },
}

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

export class DocumentContainerMismatchError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Document type, extension, and container do not agree')
    this.name = 'DocumentContainerMismatchError'
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

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function isUtf8Text(bytes: Uint8Array): boolean {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // Plain text may contain tabs and line breaks, but not binary control bytes.
    // eslint-disable-next-line no-control-regex
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded)
  } catch {
    return false
  }
}

function matchesContainer(container: DocumentContainer, bytes: Uint8Array): boolean {
  if (container === 'pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  if (container === 'ole') {
    return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  }
  if (container === 'zip') {
    return (
      startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
    )
  }
  return isUtf8Text(bytes)
}

function isDocumentContentType(value: string): value is DocumentContentType {
  return DOCUMENT_CONTENT_TYPES.some((allowed) => allowed === value)
}

export function documentContentTypeForFile(
  fileName: string,
  declaredContentType: string,
): DocumentContentType | null {
  const normalized = declaredContentType.trim().toLowerCase()
  const extension = fileName.toLowerCase().split('.').at(-1) ?? ''
  if (isDocumentContentType(normalized)) {
    return DOCUMENT_POLICIES[normalized].extensions.includes(extension) ? normalized : null
  }
  if (normalized !== '' && normalized !== 'application/octet-stream') return null
  const entry = Object.entries(DOCUMENT_POLICIES).find(([, policy]) =>
    policy.extensions.includes(extension),
  )
  return (entry?.[0] as DocumentContentType | undefined) ?? null
}

export function documentFileMatchesType(
  fileName: string,
  contentType: string,
  body: ArrayBuffer,
): boolean {
  if (!isDocumentContentType(contentType)) return false
  const extension = fileName.toLowerCase().split('.').at(-1) ?? ''
  const policy = DOCUMENT_POLICIES[contentType]
  return (
    policy.extensions.includes(extension) &&
    matchesContainer(policy.container, new Uint8Array(body))
  )
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
    assertSubmitterCapability(actor, 'portal')
    assertActorCanMutate(actor)
    if (!isDocumentContentType(input.contentType)) {
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
    if (!documentFileMatchesType(fileName, input.contentType, input.bytes)) {
      throw new DocumentContainerMismatchError()
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

  /** Metadata only — no bytes — so a remount can show the stored file. */
  async getOwnDocumentMeta(actor: SubmitterActor): Promise<DocumentDto | null> {
    assertSubmitterCapability(actor, 'portal')
    const record = await this.#files.findOwn(actor.eventId, actor.contactId, DOCUMENT_KIND)
    return record === null ? null : toDocumentDto(record)
  }

  /** Own-only read; another speaker's document is indistinguishable from none. */
  async getOwnDocument(actor: SubmitterActor): Promise<DocumentContent | null> {
    assertSubmitterCapability(actor, 'portal')
    const record = await this.#files.findOwn(actor.eventId, actor.contactId, DOCUMENT_KIND)
    if (record === null) return null
    const object = await this.#storage.get(record.storageKey)
    if (object === null) return null
    return { ...toDocumentDto(record), body: object.body }
  }
}
