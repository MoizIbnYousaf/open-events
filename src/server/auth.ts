import type { MiddlewareHandler } from 'hono'

import {
  OrganizerActor,
  SubmitterActor,
  toOrganizerActor,
  toSubmitterActor,
  type OrganizerActor as OrganizerActorType,
  type SubmitterActor as SubmitterActorType,
} from '../application/actors'

import type { ServerDeps } from './container'
import { depsFromContext } from './container'
import type { ServerContext, ServerEnv } from './env'
import type { SessionCapability } from '../domain'
import { databaseUnavailableResponse } from './env'
import { forbiddenResponse, unauthorizedResponse } from './error'

/** Single HttpOnly session cookie for both actor kinds. */
export const SESSION_COOKIE_NAME = 'sp_session'
export const TOUR_SESSION_COOKIE_NAME = 'sp_tour_session'

/**
 * Reads the session token from the Cookie header. Duplicate or malformed
 * `sp_session` cookies yield null (fail closed -> 401); only exactly one
 * non-empty value is accepted.
 */
function readCookieToken(context: ServerContext, cookieName: string): string | null {
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
    if (name === cookieName) {
      if (value.length === 0) return null
      values.push(value)
    }
  }
  if (values.length !== 1) return null
  return values[0] ?? null
}

export function readSessionToken(context: ServerContext): string | null {
  return readCookieToken(context, SESSION_COOKIE_NAME)
}

export function readTourSessionToken(context: ServerContext): string | null {
  return readCookieToken(context, TOUR_SESSION_COOKIE_NAME)
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

/** Expires the shared session cookie immediately using the same security attributes. */
export function serializeExpiredSessionCookie(secure: boolean): string {
  let cookie = `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/`
  if (secure) cookie += '; Secure'
  return `${cookie}; Max-Age=0`
}

export function serializeTourSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  let cookie = `${TOUR_SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`
  if (secure) cookie += '; Secure'
  return `${cookie}; Max-Age=${Math.max(1, Math.floor(maxAgeSeconds))}`
}

export function serializeExpiredTourSessionCookie(secure: boolean): string {
  let cookie = `${TOUR_SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/`
  if (secure) cookie += '; Secure'
  return `${cookie}; Max-Age=0`
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
    const tourToken = readTourSessionToken(context)
    const token = tourToken ?? readSessionToken(context)
    if (token === null) {
      return unauthorizedResponse(context)
    }
    const session = await deps.session.validateSession(token)
    if (session === null) {
      return unauthorizedResponse(context)
    }
    if (
      (tourToken !== null && session.provenance !== 'tour') ||
      (tourToken === null && session.provenance !== 'ordinary')
    ) {
      return unauthorizedResponse(context)
    }
    if (
      session.provenance === 'tour' &&
      context.req.method !== 'GET' &&
      context.req.method !== 'HEAD'
    ) {
      return forbiddenResponse(context)
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

/** Requires the exact purpose carried from the redeemed submitter token. */
export function requireCapability(capability: SessionCapability): MiddlewareHandler<ServerEnv> {
  return async (context, next) => {
    const actor = context.get('actor')
    if (
      !(actor instanceof SubmitterActor) ||
      (!actor.legacyBroadAuthority && actor.capability !== capability)
    ) {
      return forbiddenResponse(context)
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
