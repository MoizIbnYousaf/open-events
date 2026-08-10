import { Hono } from 'hono'

import type {
  ReplaceTaxonomyInput,
  SaveFormDraftInput,
  TaxonomyItemInput,
  UpdateEventConfigInput,
} from '../../application'
import {
  EVENT_STATUSES,
  type ElementRule,
  type EventDates,
  type EventStatus,
  type FormElement,
  type FormPage,
  type RoutingRule,
} from '../../domain'
import {
  requireActor,
  requireOrganizer,
  requireSession,
  serializeSessionCookie,
  sessionCookieMaxAgeSeconds,
} from '../auth'
import type { ServerDeps } from '../container'
import { depsFromContext } from '../container'
import { csrfGate } from '../csrf'
import type { ServerContext, ServerEnv } from '../env'
import { databaseUnavailableResponse, getTtlConfig, localAdminToken } from '../env'
import {
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
  validationFailedResponse,
} from '../error'

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

function isTaxonomyItemInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    typeof value.key === 'string' &&
    typeof value.label === 'string' &&
    typeof value.position === 'number'
  )
}

async function resolveEventId(deps: ServerDeps, slug: string): Promise<string | null> {
  const event = await deps.events.findBySlug(slug)
  return event === null ? null : event.id
}

function parseUpdateEventConfig(body: Record<string, unknown>): UpdateEventConfigInput | null {
  const allowed = new Set([
    'name',
    'timezone',
    'dates',
    'status',
    'websiteUrl',
    'organizerContact',
    'venue',
    'eventType',
  ])
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return null
  }
  const name = body.name
  const timezone = body.timezone
  const status = body.status
  const websiteUrl = body.websiteUrl
  const organizerContact = body.organizerContact
  const venue = body.venue
  const eventType = body.eventType
  const dates = body.dates
  if (name !== undefined && typeof name !== 'string') return null
  if (timezone !== undefined && typeof timezone !== 'string') return null
  if (
    status !== undefined &&
    (typeof status !== 'string' || !EVENT_STATUSES.includes(status as EventStatus))
  ) {
    return null
  }
  if (websiteUrl !== undefined && websiteUrl !== null && typeof websiteUrl !== 'string') return null
  if (
    organizerContact !== undefined &&
    organizerContact !== null &&
    typeof organizerContact !== 'string'
  ) {
    return null
  }
  if (venue !== undefined && venue !== null && typeof venue !== 'string') return null
  if (eventType !== undefined && eventType !== null && typeof eventType !== 'string') return null
  if (dates !== undefined && dates !== null) {
    if (
      !isRecord(dates) ||
      typeof dates.startsAt !== 'string' ||
      typeof dates.endsAt !== 'string'
    ) {
      return null
    }
  }
  return {
    ...(name !== undefined ? { name } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
    ...(dates !== undefined ? { dates: dates as EventDates | null } : {}),
    ...(status !== undefined ? { status: status as EventStatus } : {}),
    ...(websiteUrl !== undefined ? { websiteUrl } : {}),
    ...(organizerContact !== undefined ? { organizerContact } : {}),
    ...(venue !== undefined ? { venue } : {}),
    ...(eventType !== undefined ? { eventType } : {}),
  }
}

/** POST /api/admin/session: exchange the env-held secret for an HttpOnly cookie. */
export async function handleAdminSession(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const secret = body.secret
  if (typeof secret !== 'string') return validationFailedResponse(context)
  const expected = localAdminToken(context)
  if (expected.length === 0) return unauthorizedResponse(context)
  const ttlMs = getTtlConfig(context).organizerSessionMs
  const result = await deps.session.organizerLogin(secret, expected, ttlMs)
  const secure = new URL(context.req.url).protocol === 'https:'
  const maxAge = sessionCookieMaxAgeSeconds(result.expiresAt, deps.clock.now())
  context.header('Set-Cookie', serializeSessionCookie(result.token, maxAge, secure))
  context.header('Cache-Control', 'no-store')
  return context.json({ expiresAt: result.expiresAt })
}

/** GET /api/admin/events/:slug. */
export async function handleGetEventConfig(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const dto = await deps.eventConfig.getBySlug(actor, slug)
  return dto === null ? notFoundResponse(context) : context.json(dto)
}

/** PATCH /api/admin/events/:slug. */
export async function handleUpdateEventConfig(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const input = parseUpdateEventConfig(body)
  if (input === null) return validationFailedResponse(context)
  const dto = await deps.eventConfig.updateBySlug(actor, slug, input)
  return context.json(dto)
}

/** GET /api/admin/events/:slug/taxonomies. */
export async function handleGetTaxonomies(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const dto = await deps.taxonomy.getByEventSlug(actor, slug)
  return dto === null ? notFoundResponse(context) : context.json(dto)
}

/** PUT /api/admin/events/:slug/taxonomies. */
export async function handleReplaceTaxonomies(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const items = body.items
  if (!Array.isArray(items) || !items.every(isTaxonomyItemInput)) {
    return validationFailedResponse(context)
  }
  const input: ReplaceTaxonomyInput = { items: items as TaxonomyItemInput[] }
  const dto = await deps.taxonomy.replaceByEventSlug(actor, slug, input)
  return context.json(dto)
}

/** GET /api/admin/events/:slug/forms. */
export async function handleListForms(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const forms = await deps.formBuilder.listByEvent(actor, eventId)
  return context.json(forms)
}

/** GET /api/admin/forms/:id/draft. */
export async function handleGetFormDraft(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const formId = context.req.param('id')
  if (formId === undefined) return notFoundResponse(context)
  const draft = await deps.formBuilder.getDraft(actor, formId)
  return draft === null ? notFoundResponse(context) : context.json(draft)
}

/** GET /api/admin/forms/:id/versions. */
export async function handleListVersions(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const formId = context.req.param('id')
  if (formId === undefined) return notFoundResponse(context)
  const form = await deps.forms.findById(formId)
  if (form === null) return notFoundResponse(context)
  const versions = await deps.formBuilder.listVersions(actor, formId)
  return context.json(versions)
}

/** GET /api/admin/forms/:id/versions/:versionId. */
export async function handleGetVersionDetail(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const formId = context.req.param('id')
  const versionId = context.req.param('versionId')
  if (formId === undefined || versionId === undefined) return notFoundResponse(context)
  const detail = await deps.formBuilder.getVersionDetail(actor, formId, versionId)
  return detail === null ? notFoundResponse(context) : context.json(detail)
}

/** PUT /api/admin/forms/:id/draft. */
export async function handleUpdateFormDraft(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const formId = context.req.param('id')
  if (formId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const pages = body.pages
  const elements = body.elements
  const conditionRules = body.conditionRules
  const routingRules = body.routingRules
  if (
    !Array.isArray(pages) ||
    !Array.isArray(elements) ||
    !Array.isArray(conditionRules) ||
    !Array.isArray(routingRules)
  ) {
    return validationFailedResponse(context)
  }
  const input: SaveFormDraftInput = {
    pages: pages as FormPage[],
    elements: elements as FormElement[],
    conditionRules: conditionRules as ElementRule[],
    routingRules: routingRules as RoutingRule[],
  }
  const detail = await deps.formBuilder.updateDraft(actor, formId, input)
  return context.json(detail)
}

/** POST /api/admin/forms/:id/publish. */
export async function handlePublishForm(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const formId = context.req.param('id')
  if (formId === undefined) return notFoundResponse(context)
  const detail = await deps.formBuilder.publish(actor, formId)
  return context.json(detail)
}

/** GET /api/admin/events/:slug/submissions. */
export async function handleListSubmissions(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const submissions = await deps.submit.listByEvent(actor, eventId)
  return context.json(submissions)
}

/** GET /api/admin/events/:slug/submissions/:id. */
export async function handleGetSubmissionDetail(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('id')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const detail = await deps.submit.getDetailForEvent(actor, eventId, submissionId)
  return detail === null ? notFoundResponse(context) : context.json(detail)
}

/** POST /api/admin/submissions/:id/accept: idempotent acceptance + checklist. */
export async function handleAcceptSubmission(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const accepted = await deps.onboarding.accept(actor, submissionId)
  return context.json(accepted)
}

/** GET /api/admin/readiness?eventSlug=: onboarding readiness for one event. */
export async function handleGetReadiness(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.query('eventSlug')
  if (slug === undefined || slug.length === 0) return validationFailedResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const readiness = await deps.onboarding.readiness(actor, eventId)
  return context.json(readiness)
}

/** GET /api/admin/submissions/:id/acceptance-preview. */
export async function handleAcceptancePreview(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  return context.json(await deps.communications.previewAcceptance(actor, submissionId))
}

/** POST /api/admin/submissions/:id/acceptance-send: idempotent, append-only. */
export async function handleAcceptanceSend(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  return context.json(await deps.communications.queueAcceptance(actor, submissionId))
}

/** GET /api/admin/submissions/:id/messages: immutable send history. */
export async function handleSubmissionMessages(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  return context.json(await deps.communications.listHistory(actor, submissionId))
}

/** Registers the admin surface; CSRF runs before session validation on mutations. */
export function registerAdminRoutes(app: Hono<ServerEnv>): void {
  app.post('/api/admin/session', handleAdminSession)

  app.get(
    '/api/admin/events/:slug',
    requireSession(),
    requireActor('organizer'),
    handleGetEventConfig,
  )
  app.patch(
    '/api/admin/events/:slug',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleUpdateEventConfig,
  )
  app.get(
    '/api/admin/events/:slug/taxonomies',
    requireSession(),
    requireActor('organizer'),
    handleGetTaxonomies,
  )
  app.put(
    '/api/admin/events/:slug/taxonomies',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleReplaceTaxonomies,
  )
  app.get(
    '/api/admin/events/:slug/forms',
    requireSession(),
    requireActor('organizer'),
    handleListForms,
  )
  app.get(
    '/api/admin/events/:slug/submissions',
    requireSession(),
    requireActor('organizer'),
    handleListSubmissions,
  )
  app.get(
    '/api/admin/events/:slug/submissions/:id',
    requireSession(),
    requireActor('organizer'),
    handleGetSubmissionDetail,
  )
  app.get('/api/admin/readiness', requireSession(), requireActor('organizer'), handleGetReadiness)
  app.post(
    '/api/admin/submissions/:id/accept',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAcceptSubmission,
  )
  app.get(
    '/api/admin/submissions/:id/acceptance-preview',
    requireSession(),
    requireActor('organizer'),
    handleAcceptancePreview,
  )
  app.post(
    '/api/admin/submissions/:id/acceptance-send',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAcceptanceSend,
  )
  app.get(
    '/api/admin/submissions/:id/messages',
    requireSession(),
    requireActor('organizer'),
    handleSubmissionMessages,
  )
  app.get(
    '/api/admin/forms/:id/draft',
    requireSession(),
    requireActor('organizer'),
    handleGetFormDraft,
  )
  app.get(
    '/api/admin/forms/:id/versions',
    requireSession(),
    requireActor('organizer'),
    handleListVersions,
  )
  app.get(
    '/api/admin/forms/:id/versions/:versionId',
    requireSession(),
    requireActor('organizer'),
    handleGetVersionDetail,
  )
  app.put(
    '/api/admin/forms/:id/draft',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleUpdateFormDraft,
  )
  app.post(
    '/api/admin/forms/:id/publish',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handlePublishForm,
  )
}
