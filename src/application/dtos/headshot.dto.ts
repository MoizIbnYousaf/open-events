import type { UtcInstant } from '../../domain'
import type { UploadedFileRecord } from '../ports/uploaded-file-repository'

/**
 * Safe headshot metadata for the owning submitter: no storage key, no
 * contact id, no event id — nothing a client could use to address another
 * owner's object.
 */
export interface HeadshotDto {
  readonly id: string
  readonly contentType: string
  readonly sizeBytes: number
  readonly updatedAt: UtcInstant
}

export function toHeadshotDto(record: UploadedFileRecord): HeadshotDto {
  return {
    id: record.id,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    updatedAt: record.updatedAt,
  }
}
