import type {
  AnswerValidationIssue,
  EventConfigIssue,
  FormLimitIssue,
  FreezeIssue,
  RuleValidationIssue,
  TaxonomyIssue,
} from '../domain'

export const APPLICATION_ERROR_CODES = [
  'not_found',
  'validation_failed',
  'conflict',
  'unauthorized',
  'forbidden',
  'cfp_closed',
  'cfp_capped',
  'identity_limit_reached',
  'internal',
] as const

export type ApplicationErrorCode = (typeof APPLICATION_ERROR_CODES)[number]

export type ValidationIssue =
  | RuleValidationIssue
  | AnswerValidationIssue
  | EventConfigIssue
  | TaxonomyIssue
  | FormLimitIssue
  | FreezeIssue

/** Typed application error mapped by the API layer to a safe `ApiErrorDto`. */
export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode

  constructor(code: ApplicationErrorCode, message: string) {
    super(message)
    this.name = 'ApplicationError'
    this.code = code
  }
}

export class ValidationFailedError extends ApplicationError {
  readonly issues: readonly ValidationIssue[]

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super('validation_failed', message)
    this.name = 'ValidationFailedError'
    this.issues = issues
  }
}
