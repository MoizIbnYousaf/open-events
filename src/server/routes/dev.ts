import { Hono } from 'hono'

import { toOrganizerActor } from '../../application'
import { readSessionToken } from '../auth'
import { depsFromContext } from '../container'
import type { ServerContext, ServerEnv } from '../env'
import { databaseUnavailableResponse, isLocalDevMode } from '../env'
import { forbiddenResponse, notFoundResponse, unauthorizedResponse } from '../error'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * GET /api/dev/captured?email=: fails closed (404) outside local/test mode,
 * organizer-session only inside it; returns the raw captured demo link.
 */
export async function handleDevCaptured(context: ServerContext): Promise<Response> {
  if (!isLocalDevMode(context)) return notFoundResponse(context)
  const hostname = new URL(context.req.url).hostname
  if (!LOCAL_HOSTNAMES.has(hostname)) return notFoundResponse(context)
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const token = readSessionToken(context)
  if (token === null) return unauthorizedResponse(context)
  const session = await deps.session.validateSession(token)
  if (session === null) return unauthorizedResponse(context)
  if (toOrganizerActor(session) === null) return forbiddenResponse(context)
  const email = context.req.query('email')
  if (email === undefined || email.length === 0) return notFoundResponse(context)
  const messages = await deps.capturedMessages.listByEmail(email)
  return context.json(
    messages.map((message) => ({
      id: message.id,
      eventId: message.eventId,
      toEmail: message.toEmail,
      subject: message.subject,
      body: message.body,
      createdAt: message.createdAt,
    })),
  )
}

export function registerDevRoutes(app: Hono<ServerEnv>): void {
  app.get('/api/dev/captured', handleDevCaptured)
}
