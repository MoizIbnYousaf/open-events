import type { ApplicationErrorCode } from '../errors'

export type ApiErrorCode = ApplicationErrorCode

/** Safe error body: code + message only, never stack/SQL/environment detail. */
export interface ApiErrorDto {
  readonly error: {
    readonly code: ApiErrorCode
    readonly message: string
  }
}

export function toApiErrorDto(code: ApiErrorCode, message: string): ApiErrorDto {
  return { error: { code, message } }
}
