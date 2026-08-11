import { Hono } from 'hono'

import type {
  AssignEvaluatorInput,
  CriterionInput,
  DefineCriteriaInput,
  OpenRoundInput,
  PlaceAgendaSessionInput,
  ReplaceTaxonomyInput,
  SaveFormDraftInput,
  TaxonomyItemInput,
  UpdateEventConfigInput,
} from '../../application'
import { EVENT_STATUSES, type EventDates, type EventStatus } from '../../domain/event'
import type { FormElement, FormPage } from '../../domain/form-version'
import type { ElementRule, RoutingRule } from '../../domain/rules'
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

function isCriterionInput(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.weight === 'number' &&
    typeof value.position === 'number'
  )
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

/** Placement body: exactly the five placement fields, `trackId` optional. */
function parsePlaceAgendaSession(body: Record<string, unknown>): PlaceAgendaSessionInput | null {
  const allowed = new Set(['day', 'roomId', 'trackId', 'start', 'end'])
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return null
  }
  const { day, roomId, trackId, start, end } = body
  if (
    typeof day !== 'string' ||
    typeof roomId !== 'string' ||
    typeof start !== 'string' ||
    typeof end !== 'string'
  ) {
    return null
  }
  if (trackId !== undefined && trackId !== null && typeof trackId !== 'string') return null
  return { day, roomId, start, end, trackId: typeof trackId === 'string' ? trackId : null }
}

/** GET /api/admin/events/:slug/agenda: the placeable board for one event. */
export async function handleGetAgendaBoard(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const board = await deps.agendaBoard.getBoardBySlug(actor, slug)
  return board === null ? notFoundResponse(context) : context.json(board)
}

/**
 * PUT /api/admin/events/:slug/agenda/:submissionId: place one accepted
 * submission. The event comes from the slug and the service checks the
 * submission against it, so the path can never reach another event's agenda.
 */
export async function handlePlaceAgendaSession(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('submissionId')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const input = parsePlaceAgendaSession(body)
  if (input === null) return validationFailedResponse(context)
  return context.json(await deps.agendaBoard.place(actor, slug, submissionId, input))
}

/**
 * DELETE /api/admin/events/:slug/agenda/:submissionId: take one session back
 * off the schedule. Same event predicate as the placement, so a retraction can
 * never reach another event's agenda.
 */
export async function handleUnplaceAgendaSession(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('submissionId')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  return context.json(await deps.agendaBoard.unplace(actor, slug, submissionId))
}

/** POST /api/admin/events/:slug/agenda/publish: idempotent, scheduled-only. */
export async function handlePublishAgenda(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  return context.json(await deps.agendaBoard.publish(actor, slug))
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
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const draft = await deps.formBuilder.getDraft(actor, eventId, formId)
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
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const versions = await deps.formBuilder.listVersions(actor, eventId, formId)
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
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const detail = await deps.formBuilder.getVersionDetail(actor, eventId, formId, versionId)
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
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const detail = await deps.formBuilder.updateDraft(actor, eventId, formId, input)
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
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const detail = await deps.formBuilder.publish(actor, eventId, formId)
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
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const accepted = await deps.onboarding.accept(actor, eventId, submissionId)
  return context.json(accepted)
}

/**
 * POST /api/admin/submissions/:id/form-tasks: assign a published form to one
 * accepted speaker as a form-backed onboarding task (idempotent).
 */
export async function handleAssignFormTask(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.formId !== 'string' || typeof body.contactId !== 'string') {
    return validationFailedResponse(context)
  }
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const task = await deps.onboarding.assignFormTask(actor, eventId, submissionId, {
    formId: body.formId,
    contactId: body.contactId,
  })
  return context.json(task)
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
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.communications.previewAcceptance(actor, eventId, submissionId))
}

/** POST /api/admin/submissions/:id/acceptance-send: idempotent, append-only. */
export async function handleAcceptanceSend(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.communications.queueAcceptance(actor, eventId, submissionId))
}

/** GET /api/admin/submissions/:id/reminder-preview. */
export async function handleReminderPreview(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.communications.previewReminder(actor, eventId, submissionId))
}

/** POST /api/admin/submissions/:id/reminder-send: idempotent, append-only. */
export async function handleReminderSend(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.communications.queueReminder(actor, eventId, submissionId))
}

/** GET /api/admin/submissions/:id/messages: immutable send history. */
export async function handleSubmissionMessages(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.communications.listHistory(actor, eventId, submissionId))
}

/** GET /api/admin/events/:slug/criteria: the event's weighted criteria. */
export async function handleListCriteria(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.listCriteria(actor, eventId))
}

/** POST /api/admin/events/:slug/criteria: define criteria, keyed by name. */
export async function handleDefineCriteria(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const criteria = body.criteria
  if (!Array.isArray(criteria) || !criteria.every(isCriterionInput)) {
    return validationFailedResponse(context)
  }
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const input: DefineCriteriaInput = { criteria: criteria as CriterionInput[] }
  return context.json(await deps.evaluations.defineCriteria(actor, eventId, input))
}

/** GET /api/admin/events/:slug/rounds: the event's review rounds. */
export async function handleListRounds(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.listRounds(actor, eventId))
}

/** POST /api/admin/events/:slug/rounds: open a numbered round (idempotent). */
export async function handleOpenRound(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const number = body.number
  const name = body.name
  if (typeof number !== 'number' || typeof name !== 'string') {
    return validationFailedResponse(context)
  }
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const input: OpenRoundInput = { number, name }
  return context.json(await deps.evaluations.openRound(actor, eventId, input))
}

/** POST /api/admin/rounds/:id/close: idempotent one-way close. */
export async function handleCloseRound(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const roundId = context.req.param('id')
  if (roundId === undefined) return notFoundResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.closeRound(actor, eventId, roundId))
}

/** GET /api/admin/submissions/:id/assignments: the committee roster. */
export async function handleListAssignments(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.listAssignments(actor, eventId, submissionId))
}

/** POST /api/admin/submissions/:id/assignments: idempotent evaluator assignment. */
export async function handleAssignEvaluator(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const evaluatorEmail = body.evaluatorEmail
  const roundId = body.roundId
  if (typeof evaluatorEmail !== 'string') return validationFailedResponse(context)
  if (roundId !== undefined && typeof roundId !== 'string') return validationFailedResponse(context)
  const input: AssignEvaluatorInput = {
    evaluatorEmail,
    ...(typeof roundId === 'string' ? { roundId } : {}),
  }
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.assign(actor, eventId, submissionId, input))
}

/** GET /api/admin/submissions/:id/evaluation-summary: weighted totals. */
export async function handleEvaluationSummary(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const submissionId = context.req.param('id')
  if (submissionId === undefined) return notFoundResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.weightedSummary(actor, eventId, submissionId))
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
    '/api/admin/events/:slug/agenda',
    requireSession(),
    requireActor('organizer'),
    handleGetAgendaBoard,
  )
  app.put(
    '/api/admin/events/:slug/agenda/:submissionId',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handlePlaceAgendaSession,
  )
  app.delete(
    '/api/admin/events/:slug/agenda/:submissionId',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleUnplaceAgendaSession,
  )
  app.post(
    '/api/admin/events/:slug/agenda/publish',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handlePublishAgenda,
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
  app.get(
    '/api/admin/events/:slug/criteria',
    requireSession(),
    requireActor('organizer'),
    handleListCriteria,
  )
  app.post(
    '/api/admin/events/:slug/criteria',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleDefineCriteria,
  )
  app.get(
    '/api/admin/events/:slug/rounds',
    requireSession(),
    requireActor('organizer'),
    handleListRounds,
  )
  app.post(
    '/api/admin/events/:slug/rounds',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleOpenRound,
  )
  app.post(
    '/api/admin/events/:slug/rounds/:id/close',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleCloseRound,
  )
  app.get(
    '/api/admin/events/:slug/submissions/:id/assignments',
    requireSession(),
    requireActor('organizer'),
    handleListAssignments,
  )
  app.post(
    '/api/admin/events/:slug/submissions/:id/assignments',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAssignEvaluator,
  )
  app.get(
    '/api/admin/events/:slug/submissions/:id/evaluation-summary',
    requireSession(),
    requireActor('organizer'),
    handleEvaluationSummary,
  )
  app.get('/api/admin/readiness', requireSession(), requireActor('organizer'), handleGetReadiness)
  app.post(
    '/api/admin/events/:slug/submissions/:id/accept',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAcceptSubmission,
  )
  app.post(
    '/api/admin/events/:slug/submissions/:id/form-tasks',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAssignFormTask,
  )
  app.get(
    '/api/admin/events/:slug/submissions/:id/acceptance-preview',
    requireSession(),
    requireActor('organizer'),
    handleAcceptancePreview,
  )
  app.post(
    '/api/admin/events/:slug/submissions/:id/acceptance-send',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAcceptanceSend,
  )
  app.get(
    '/api/admin/events/:slug/submissions/:id/reminder-preview',
    requireSession(),
    requireActor('organizer'),
    handleReminderPreview,
  )
  app.post(
    '/api/admin/events/:slug/submissions/:id/reminder-send',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleReminderSend,
  )
  app.get(
    '/api/admin/events/:slug/submissions/:id/messages',
    requireSession(),
    requireActor('organizer'),
    handleSubmissionMessages,
  )
  app.get(
    '/api/admin/events/:slug/forms/:id/draft',
    requireSession(),
    requireActor('organizer'),
    handleGetFormDraft,
  )
  app.get(
    '/api/admin/events/:slug/forms/:id/versions',
    requireSession(),
    requireActor('organizer'),
    handleListVersions,
  )
  app.get(
    '/api/admin/events/:slug/forms/:id/versions/:versionId',
    requireSession(),
    requireActor('organizer'),
    handleGetVersionDetail,
  )
  app.put(
    '/api/admin/events/:slug/forms/:id/draft',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleUpdateFormDraft,
  )
  app.post(
    '/api/admin/events/:slug/forms/:id/publish',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handlePublishForm,
  )
}
