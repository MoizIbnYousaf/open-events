import { Hono } from 'hono'

import { depsFromContext } from '../container'
import type { ServerContext, ServerEnv } from '../env'
import { databaseUnavailableResponse, isLocalDevMode } from '../env'
import { notFoundResponse } from '../error'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * GET /api/dev/captured?email=: fails closed (404) outside local/test mode and
 * off a localhost hostname; inside that sealed local path it needs no session
 * at all and returns the raw captured demo link.
 *
 * The two guards below are the security boundary, and they are absolute: a
 * deployed build answers 404 to every caller, organizer or not. Inside local
 * dev the session requirement was doing no security work and real harm — an
 * automated test harness drives each persona in an isolated browser context, so a
 * speaker or reviewer holds no organizer cookie and could never read the magic
 * link addressed to it. The whole speaker journey was unreachable to anything
 * but a single context holding every identity at once.
 */
export async function handleDevCaptured(context: ServerContext): Promise<Response> {
  if (!isLocalDevMode(context)) return notFoundResponse(context)
  const hostname = new URL(context.req.url).hostname
  if (!LOCAL_HOSTNAMES.has(hostname)) return notFoundResponse(context)
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
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
