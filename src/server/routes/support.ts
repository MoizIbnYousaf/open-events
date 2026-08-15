import { Hono } from 'hono'

import { OrganizerActor, toSubmitterActor } from '../../application/actors'
import { csrfGate } from '../csrf'
import { depsFromContext } from '../container'
import { requireActor, requireSession, readSessionToken } from '../auth'
import { databaseUnavailableResponse } from '../env'
import type { ServerContext, ServerEnv } from '../env'
import {
  notFoundResponse,
  toErrorResponse,
  unauthorizedResponse,
  validationFailedResponse,
} from '../error'
import { ApplicationError } from '../../application/errors'
import { readSupportGuestToken, serializeSupportGuestCookie } from '../support-cookie'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonBody(context: ServerContext): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await context.req.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

async function sessionSubject(context: ServerContext): Promise<{
  readonly contactId: string | null
  readonly organizer: boolean
}> {
  const deps = depsFromContext(context)
  if (deps === null) return { contactId: null, organizer: false }
  const token = readSessionToken(context)
  if (token === null) return { contactId: null, organizer: false }
  const session = await deps.session.validateSession(token)
  if (session === null) return { contactId: null, organizer: false }
  if (session.kind === 'organizer') return { contactId: null, organizer: true }
  const actor = toSubmitterActor(session)
  return { contactId: actor?.contactId ?? null, organizer: false }
}

function eventSlugFrom(context: ServerContext, body?: Record<string, unknown> | null): string {
  const query = context.req.query('eventSlug')
  if (typeof query === 'string' && query.length > 0) return query
  const fromBody = body?.eventSlug
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody
  return 'demo-conf-2026'
}

function applyGuestCookie(context: ServerContext, token: string | null): void {
  if (token === null) return
  context.header(
    'set-cookie',
    serializeSupportGuestCookie(token, new URL(context.req.url).protocol === 'https:'),
    { append: true },
  )
}

async function handleGetOwn(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  try {
    const subject = await sessionSubject(context)
    const dto = await deps.support.getSession({
      eventSlug: eventSlugFrom(context),
      contactId: subject.contactId,
      guestToken: readSupportGuestToken(context),
      organizer: subject.organizer,
    })
    return context.json(dto)
  } catch (error) {
    if (error instanceof ApplicationError) {
      return toErrorResponse(context, error.code, error.code === 'not_found' ? 404 : 400)
    }
    throw error
  }
}

async function handleIdentify(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const subject = await sessionSubject(context)
  if (subject.organizer)
    return context.json({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
  try {
    const dto = await deps.support.identify({
      eventSlug: eventSlugFrom(context, body),
      name: typeof body.name === 'string' ? body.name : '',
      email: typeof body.email === 'string' ? body.email : '',
      contactId: subject.contactId,
    })
    applyGuestCookie(context, dto.guestToken)
    return context.json({ ...dto, guestToken: null })
  } catch (error) {
    if (error instanceof ApplicationError) {
      return toErrorResponse(
        context,
        error.code,
        error.code === 'not_found' ? 404 : error.code === 'validation_failed' ? 400 : 401,
      )
    }
    throw error
  }
}

async function handleSendOwn(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const subject = await sessionSubject(context)
  if (subject.organizer)
    return context.json({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
  try {
    const message = await deps.support.sendUserMessage({
      eventSlug: eventSlugFrom(context, body),
      contactId: subject.contactId,
      guestToken: readSupportGuestToken(context),
      content: typeof body.content === 'string' ? body.content : '',
    })
    return context.json(message)
  } catch (error) {
    if (error instanceof ApplicationError) {
      return toErrorResponse(
        context,
        error.code,
        error.code === 'unauthorized' ? 401 : error.code === 'not_found' ? 404 : 400,
      )
    }
    throw error
  }
}

async function handleMarkRead(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const subject = await sessionSubject(context)
  if (subject.organizer)
    return context.json({ error: { code: 'forbidden', message: 'Forbidden' } }, 403)
  try {
    const chat = await deps.support.markRead({
      eventSlug: eventSlugFrom(context),
      contactId: subject.contactId,
      guestToken: readSupportGuestToken(context),
    })
    return context.json(chat)
  } catch (error) {
    if (error instanceof ApplicationError) {
      return toErrorResponse(context, error.code, error.code === 'unauthorized' ? 401 : 400)
    }
    throw error
  }
}

function requireSlug(context: ServerContext): string | null {
  return context.req.param('slug') ?? null
}

function requireSlugAndId(context: ServerContext): { slug: string; id: string } | null {
  const slug = context.req.param('slug')
  const id = context.req.param('id')
  if (slug === undefined || id === undefined) return null
  return { slug, id }
}

async function handleList(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = context.get('actor')
  if (!(actor instanceof OrganizerActor)) return unauthorizedResponse(context)
  const slug = requireSlug(context)
  if (slug === null) return notFoundResponse(context)
  const archived = context.req.query('archived') === 'true'
  try {
    const chats = await deps.support.listChats(actor, slug, archived)
    return context.json(chats)
  } catch (error) {
    if (error instanceof ApplicationError) {
      return toErrorResponse(context, error.code, error.code === 'not_found' ? 404 : 400)
    }
    throw error
  }
}

async function handleGetAdmin(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = context.get('actor')
  if (!(actor instanceof OrganizerActor)) return unauthorizedResponse(context)
  const params = requireSlugAndId(context)
  if (params === null) return notFoundResponse(context)
  try {
    const chat = await deps.support.getAdminChat(actor, params.slug, params.id)
    return context.json(chat)
  } catch (error) {
    if (error instanceof ApplicationError) {
      return error.code === 'not_found'
        ? notFoundResponse(context)
        : toErrorResponse(context, error.code, 400)
    }
    throw error
  }
}

async function handleAdminSend(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = context.get('actor')
  if (!(actor instanceof OrganizerActor)) return unauthorizedResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const params = requireSlugAndId(context)
  if (params === null) return notFoundResponse(context)
  try {
    const message = await deps.support.sendAdminMessage(
      actor,
      params.slug,
      params.id,
      typeof body.content === 'string' ? body.content : '',
    )
    return context.json(message)
  } catch (error) {
    if (error instanceof ApplicationError) {
      return error.code === 'not_found'
        ? notFoundResponse(context)
        : toErrorResponse(context, error.code, 400)
    }
    throw error
  }
}

async function handleArchive(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = context.get('actor')
  if (!(actor instanceof OrganizerActor)) return unauthorizedResponse(context)
  const params = requireSlugAndId(context)
  if (params === null) return notFoundResponse(context)
  try {
    const chat = await deps.support.setArchived(actor, params.slug, params.id, true)
    return context.json(chat)
  } catch (error) {
    if (error instanceof ApplicationError) {
      return error.code === 'not_found'
        ? notFoundResponse(context)
        : toErrorResponse(context, error.code, 400)
    }
    throw error
  }
}

async function handleUnarchive(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = context.get('actor')
  if (!(actor instanceof OrganizerActor)) return unauthorizedResponse(context)
  const params = requireSlugAndId(context)
  if (params === null) return notFoundResponse(context)
  try {
    const chat = await deps.support.setArchived(actor, params.slug, params.id, false)
    return context.json(chat)
  } catch (error) {
    if (error instanceof ApplicationError) {
      return error.code === 'not_found'
        ? notFoundResponse(context)
        : toErrorResponse(context, error.code, 400)
    }
    throw error
  }
}

export function registerSupportRoutes(app: Hono<ServerEnv>): void {
  app.get('/api/support-chat', handleGetOwn)
  app.post('/api/support-chat', csrfGate(), handleIdentify)
  app.post('/api/support-chat/messages', csrfGate(), handleSendOwn)
  app.patch('/api/support-chat/mark-read', csrfGate(), handleMarkRead)

  app.get(
    '/api/admin/events/:slug/support/chats',
    requireSession(),
    requireActor('organizer'),
    handleList,
  )
  app.get(
    '/api/admin/events/:slug/support/chats/:id',
    requireSession(),
    requireActor('organizer'),
    handleGetAdmin,
  )
  app.post(
    '/api/admin/events/:slug/support/chats/:id/messages',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAdminSend,
  )
  app.post(
    '/api/admin/events/:slug/support/chats/:id/archive',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleArchive,
  )
  app.post(
    '/api/admin/events/:slug/support/chats/:id/unarchive',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleUnarchive,
  )
}
