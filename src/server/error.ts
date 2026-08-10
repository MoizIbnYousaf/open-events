import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { toApiErrorDto } from '../application/dtos/error.dto'
import { ApplicationError, type ApplicationErrorCode } from '../application/errors'

import { ConfigError } from './env'

/** Fixed, generic messages per code; never echoes ids, SQL, tokens, or env. */
const ERROR_MESSAGES: Record<ApplicationErrorCode, string> = {
  not_found: 'Not found',
  validation_failed: 'Validation failed',
  conflict: 'Conflict',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  cfp_closed: 'The call for papers is closed',
  cfp_capped: 'The submission cap has been reached',
  identity_limit_reached: 'The per-identity submission limit has been reached',
  internal: 'Internal error',
}

const ERROR_STATUSES: Record<ApplicationErrorCode, ContentfulStatusCode> = {
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  unauthorized: 401,
  forbidden: 403,
  cfp_closed: 409,
  cfp_capped: 409,
  identity_limit_reached: 409,
  internal: 500,
}

/** Single safe error envelope: `{ error: { code, message } }`. */
export function toErrorResponse(
  context: Context,
  code: ApplicationErrorCode,
  status: ContentfulStatusCode,
): Response {
  return context.json(toApiErrorDto(code, ERROR_MESSAGES[code]), status)
}

export function notFoundResponse(context: Context): Response {
  return toErrorResponse(context, 'not_found', 404)
}

export function unauthorizedResponse(context: Context): Response {
  return toErrorResponse(context, 'unauthorized', 401)
}

export function forbiddenResponse(context: Context): Response {
  return toErrorResponse(context, 'forbidden', 403)
}

export function validationFailedResponse(context: Context): Response {
  return toErrorResponse(context, 'validation_failed', 400)
}

/**
 * App error handler: maps every failure to the single `ApiErrorDto` envelope.
 * Stack/SQL/token/biography/env/validation internals never reach the body;
 * the detailed error is logged server-side only.
 */
export function handleError(error: unknown, context: Context): Response {
  if (error instanceof ApplicationError) {
    console.error('unhandled API error', error)
    return toErrorResponse(context, error.code, ERROR_STATUSES[error.code])
  }
  if (error instanceof ConfigError) {
    console.error('configuration error', error)
    return toErrorResponse(context, 'internal', 500)
  }
  console.error('unhandled API error', error)
  return toErrorResponse(context, 'internal', 500)
}

/** Uniform 404 envelope for unmatched routes. */
export function handleNotFound(context: Context): Response {
  return notFoundResponse(context)
}
