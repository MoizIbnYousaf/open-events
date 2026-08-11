import type { ContactId, EventId, UtcInstant } from '../../domain'

/** Upload kinds backed by `uploaded_files.kind`. */
export const UPLOADED_FILE_KINDS = ['headshot', 'document'] as const

export type UploadedFileKind = (typeof UPLOADED_FILE_KINDS)[number]

/** Persisted upload metadata (camelCase mirror of `uploaded_files`). */
export interface UploadedFileRecord {
  readonly id: string
  readonly eventId: EventId
  readonly ownerContactId: ContactId
  readonly kind: UploadedFileKind
  readonly storageKey: string
  readonly contentType: string
  readonly sizeBytes: number
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
  /** Sanitized display name; present exactly for `document` rows (0014). */
  readonly fileName?: string | null
}

export interface UploadedFileRepository {
  findOwn(
    eventId: EventId,
    ownerContactId: ContactId,
    kind: UploadedFileKind,
  ): Promise<UploadedFileRecord | null>
  /**
   * Replaces the single current row for (event, owner, kind) and returns the
   * row it replaced (null on first upload) so the caller can retire the
   * superseded object. Exactly one row per owner+kind survives.
   */
  upsert(record: UploadedFileRecord): Promise<UploadedFileRecord | null>
}
