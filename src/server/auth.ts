import type { MiddlewareHandler } from 'hono'

import {
  OrganizerActor,
  SubmitterActor,
  toOrganizerActor,
  toSubmitterActor,
  type OrganizerActor as OrganizerActorType,
  type SubmitterActor as SubmitterActorType,
} from '../application'

import type { ServerDeps } from './container'
import { depsFromContext } from './container'
import type { ServerContext, ServerEnv } from './env'
import { databaseUnavailableResponse } from './env'
import { forbiddenResponse, unauthorizedResponse } from './error'

/** Single HttpOnly session cookie for both actor kinds. */
export const SESSION_COOKIE_NAME = 'sp_session'

/**
 * Reads the session token from the Cookie header. Duplicate or malformed
 * `sp_session` cookies yield null (fail closed -> 401); only exactly one
 * non-empty value is accepted.
 */
export function readSessionToken(context: ServerContext): string | null {
  const header = context.req.header('cookie')
  if (header === undefined) return null
  const values: string[] = []
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const name = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (name === SESSION_COOKIE_NAME) {
      if (value.length === 0) return null
      values.push(value)
    }
  }
  if (values.length !== 1) return null
  return values[0] ?? null
}

/**
 * Serializes the session cookie with the frozen attributes. `Secure` is only
 * set over HTTPS; `Max-Age` is always present, `Expires` is never emitted.
 */
export function serializeSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  let cookie = `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`
  if (secure) cookie += '; Secure'
  cookie += `; Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`
  return cookie
}

/** Cookie Max-Age derived from the session expiry and the server clock. */
export function sessionCookieMaxAgeSeconds(expiresAt: string, now: string): number {
  const diffMs = Date.parse(expiresAt) - Date.parse(now)
  return Math.max(1, Math.floor(diffMs / 1000))
}

/** Requires a valid session cookie; 401 for missing/invalid/expired sessions. */
export function requireSession(): MiddlewareHandler<ServerEnv> {
  return async (context, next) => {
    const deps: ServerDeps | null = depsFromContext(context)
    if (deps === null) {
      return databaseUnavailableResponse(context)
    }
    const token = readSessionToken(context)
    if (token === null) {
      return unauthorizedResponse(context)
    }
    const session = await deps.session.validateSession(token)
    if (session === null) {
      return unauthorizedResponse(context)
    }
    context.set('session', session)
    await next()
  }
}

/** Requires the session to be of the given actor kind; 403 on mismatch. */
export function requireActor(kind: 'organizer' | 'submitter'): MiddlewareHandler<ServerEnv> {
  return async (context, next) => {
    const session = context.get('session')
    if (kind === 'organizer') {
      const actor = toOrganizerActor(session)
      if (actor === null) {
        return forbiddenResponse(context)
      }
      context.set('actor', actor)
    } else {
      const actor = toSubmitterActor(session)
      if (actor === null) {
        return forbiddenResponse(context)
      }
      context.set('actor', actor)
    }
    await next()
  }
}

/** Narrowing accessor; null when the actor is not a submitter. */
export function requireSubmitter(context: ServerContext): SubmitterActorType | null {
  const actor = context.get('actor')
  return actor instanceof SubmitterActor ? actor : null
}

/** Narrowing accessor; null when the actor is not an organizer. */
export function requireOrganizer(context: ServerContext): OrganizerActorType | null {
  const actor = context.get('actor')
  return actor instanceof OrganizerActor ? actor : null
}
