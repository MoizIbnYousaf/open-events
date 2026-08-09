import { Hono } from 'hono'

import type { CoSpeakerInput, SaveDraftInput, StartInput, SubmitInput } from '../../application'
import type { AnswerMap } from '../../domain'
import {
  requireActor,
  requireSession,
  requireSubmitter,
  serializeSessionCookie,
  sessionCookieMaxAgeSeconds,
} from '../auth'
import { depsFromContext } from '../container'
import { csrfGate } from '../csrf'
import type { ServerContext, ServerEnv } from '../env'
import { databaseUnavailableResponse, getTtlConfig } from '../env'
import { forbiddenResponse, notFoundResponse, validationFailedResponse } from '../error'
import { handleHealth } from '../health'
import { handleGetEvent } from './events'

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

function isCoSpeakerInput(value: unknown): boolean {
  return isRecord(value) && typeof value.name === 'string' && typeof value.email === 'string'
}

/** POST /api/public/start: generic 202, never a link or token. */
export async function handleStart(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const email = body.email
  const eventSlug = body.eventSlug
  const formSlug = body.formSlug
  if (typeof email !== 'string' || typeof eventSlug !== 'string' || typeof formSlug !== 'string') {
    return validationFailedResponse(context)
  }
  const input: StartInput = { email, eventSlug, formSlug }
  const ttlMs = getTtlConfig(context).submitterTokenMs
  const linkBuilder = (token: string, _path: string): string => {
    void _path
    return `/api/public/session?token=${encodeURIComponent(token)}`
  }
  const result = await deps.session.startSubmitter(input, ttlMs, linkBuilder)
  return context.json(result, 202)
}

/** GET /api/public/session?token=: 303 to the trusted two-segment path. */
export async function handleSessionExchange(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const token = context.req.query('token')
  if (token === undefined || token.length === 0) return validationFailedResponse(context)
  const ttlMs = getTtlConfig(context).submitterSessionMs
  const result = await deps.session.redeemSubmitterToken(token, ttlMs)
  const secure = new URL(context.req.url).protocol === 'https:'
  const maxAge = sessionCookieMaxAgeSeconds(result.expiresAt, deps.clock.now())
  return new Response(null, {
    status: 303,
    headers: {
      Location: result.redirectPath,
      'Set-Cookie': serializeSessionCookie(result.token, maxAge, secure),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

/** GET /api/public/cfp/:eventSlug/:formSlug: published definition only. */
export async function handleGetPublishedCfp(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const eventSlug = context.req.param('eventSlug')
  const formSlug = context.req.param('formSlug')
  if (eventSlug === undefined || formSlug === undefined) return notFoundResponse(context)
  const definition = await deps.formBuilder.getPublishedByEventSlug(eventSlug, formSlug)
  return definition === null ? notFoundResponse(context) : context.json(definition)
}

/** GET /api/public/draft?formId=: active draft for the session actor. */
export async function handleGetActiveDraft(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const formId = context.req.query('formId')
  if (formId === undefined || formId.length === 0) return validationFailedResponse(context)
  const draft = await deps.drafts.getActiveDraft(actor, formId)
  return draft === null ? notFoundResponse(context) : context.json(draft)
}

/** GET /api/public/draft/:id: own draft only. */
export async function handleGetDraft(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const draftId = context.req.param('id')
  if (draftId === undefined) return notFoundResponse(context)
  const draft = await deps.drafts.get(actor, draftId)
  return draft === null ? notFoundResponse(context) : context.json(draft)
}

/** PUT /api/public/draft: actor-scoped save; owner/event come from the session. */
export async function handleSaveDraft(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const id = body.id
  const formId = body.formId
  const formVersionId = body.formVersionId
  const title = body.title
  const answers = body.answers
  if (
    !(id === null || typeof id === 'string') ||
    typeof formId !== 'string' ||
    typeof formVersionId !== 'string' ||
    typeof title !== 'string' ||
    !isRecord(answers)
  ) {
    return validationFailedResponse(context)
  }
  const input: SaveDraftInput = {
    id,
    formId,
    formVersionId,
    title,
    answers: answers as AnswerMap,
  }
  const draft = await deps.drafts.save(actor, input)
  return context.json(draft)
}

/** POST /api/public/submit: idempotent, actor-scoped, gate outcomes -> 409. */
export async function handleSubmit(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const originDraftId = body.originDraftId
  const formVersionId = body.formVersionId
  const title = body.title
  const answers = body.answers
  const coSpeakers = body.coSpeakers
  if (
    typeof originDraftId !== 'string' ||
    typeof formVersionId !== 'string' ||
    typeof title !== 'string' ||
    !isRecord(answers) ||
    !Array.isArray(coSpeakers) ||
    !coSpeakers.every(isCoSpeakerInput)
  ) {
    return validationFailedResponse(context)
  }
  const input: SubmitInput = {
    originDraftId,
    formVersionId,
    title,
    answers: answers as AnswerMap,
    coSpeakers: coSpeakers as CoSpeakerInput[],
  }
  const submission = await deps.submit.submit(actor, input)
  return context.json(submission)
}

/** GET /api/public/submission/:id: own submission only. */
export async function handleGetOwnSubmission(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireSubmitter(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const submission = await deps.submit.getOwnDetail(actor, submissionId)
  return submission === null ? notFoundResponse(context) : context.json(submission)
}

/** Registers the public surface; CSRF runs before session validation on mutations. */
export function registerPublicRoutes(app: Hono<ServerEnv>): void {
  app.get('/api/health', handleHealth)
  app.get('/api/events/:slug', handleGetEvent)

  app.post('/api/public/start', handleStart)
  app.get('/api/public/session', handleSessionExchange)
  app.get('/api/public/cfp/:eventSlug/:formSlug', handleGetPublishedCfp)

  app.get('/api/public/draft', requireSession(), requireActor('submitter'), handleGetActiveDraft)
  app.get('/api/public/draft/:id', requireSession(), requireActor('submitter'), handleGetDraft)
  app.put(
    '/api/public/draft',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleSaveDraft,
  )
  app.post(
    '/api/public/submit',
    csrfGate(),
    requireSession(),
    requireActor('submitter'),
    handleSubmit,
  )
  app.get(
    '/api/public/submission/:id',
    requireSession(),
    requireActor('submitter'),
    handleGetOwnSubmission,
  )
}
