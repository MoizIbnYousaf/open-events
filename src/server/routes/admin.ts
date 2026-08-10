import { Hono } from 'hono'

import type {
  AddCommitteeMemberInput,
  AssignEvaluatorInput,
  CriterionInput,
  DefineCriteriaInput,
  OpenRoundInput,
  RoundCriterionInput,
  PlaceAgendaSessionInput,
  ReplaceTaxonomyInput,
  SaveFormDraftInput,
  TaxonomyItemInput,
  UpdateEventConfigInput,
} from '../../application'
import { EVENT_STATUSES, type EventDates, type EventStatus } from '../../domain/event'
import type { FormElement, FormPage } from '../../domain/form-version'
import type { ElementRule, RoutingRule } from '../../domain/rules'
import { isSubmissionDecisionOutcome } from '../../domain/submission'
import {
  requireActor,
  requireOrganizer,
  requireSession,
  serializeSessionCookie,
  sessionCookieMaxAgeSeconds,
} from '../auth'
import type { ServerDeps } from '../container'
import { depsFromContext } from '../container'
import { readBearerToken, verifyClerkSessionToken } from '../clerk'
import { csrfGate } from '../csrf'
import {
  clerkPublishableKey,
  clerkSecretKey,
  databaseUnavailableResponse,
  getAllowedOrigins,
  getTtlConfig,
  localAdminToken,
  type ServerContext,
  type ServerEnv,
} from '../env'
import {
  forbiddenResponse,
  notFoundResponse,
  toErrorResponse,
  unauthorizedResponse,
  validationFailedResponse,
} from '../error'
import { sendReviewerInvite } from '../reviewer-invite'
import {
  HEADSHOT_MAX_BYTES,
  HeadshotEmptyError,
  HeadshotTooLargeError,
  HeadshotUnsupportedTypeError,
} from '../../application'

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

/** POST /api/admin/session/clerk: exchange a verified Clerk JWT for the organizer cookie. */
export async function handleAdminClerkSession(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const publishableKey = clerkPublishableKey(context)
  const secretKey = clerkSecretKey(context)
  if (publishableKey.length === 0 && secretKey.length === 0) {
    return unauthorizedResponse(context)
  }
  const body = await readJsonBody(context)
  const bodyToken = body !== null && typeof body.token === 'string' ? body.token : null
  const token = readBearerToken(context) ?? bodyToken
  if (token === null || token.length === 0) return unauthorizedResponse(context)
  const identity = await verifyClerkSessionToken(token, {
    publishableKey,
    secretKey,
    authorizedParties: getAllowedOrigins(context),
    nowMs: Date.parse(deps.clock.now()),
  })
  if (identity === null) return unauthorizedResponse(context)
  const ttlMs = getTtlConfig(context).organizerSessionMs
  const result = await deps.session.issueOrganizerSession(ttlMs)
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

/**
 * POST /api/admin/events/:slug/agenda/auto-place: fill the grid's free slots
 * with the sessions nobody has placed, never creating a conflict.
 */
export async function handleAutoPlaceAgenda(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  return context.json(await deps.agendaBoard.autoPlace(actor, slug))
}

/** GET /api/admin/events/:slug/messages: everything this event has sent. */
export async function handleListMessages(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.capturedMessages.listForEvent(actor, eventId))
}

/** GET /api/admin/events/:slug/speakers: the people on this programme. */
export async function handleListSpeakers(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.speakers.listRoster(actor, eventId))
}

/** GET /api/admin/events — every event this organizer can open. */
export async function handleListEvents(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  return context.json(await deps.eventConfig.list(actor))
}

/** POST /api/admin/events — create a second (or first) event. */
export async function handleCreateEvent(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.name !== 'string') return validationFailedResponse(context)
  const created = await deps.eventConfig.create(actor, {
    name: body.name,
    timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
    startsAt: typeof body.startsAt === 'string' ? body.startsAt : null,
    endsAt: typeof body.endsAt === 'string' ? body.endsAt : null,
  })
  return context.json(created, 201)
}

/** POST /api/admin/events/:slug/speakers */
export async function handleAddSpeaker(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.name !== 'string' || typeof body.email !== 'string') {
    return validationFailedResponse(context)
  }
  return context.json(
    await deps.speakers.addSpeaker(actor, eventId, {
      name: body.name,
      email: body.email,
      bio: typeof body.bio === 'string' ? body.bio : undefined,
      jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle : undefined,
      company: typeof body.company === 'string' ? body.company : undefined,
      travelNotes: typeof body.travelNotes === 'string' ? body.travelNotes : undefined,
    }),
    201,
  )
}

/** POST /api/admin/events/:slug/speakers/import */
export async function handleImportSpeakers(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.csv !== 'string') return validationFailedResponse(context)
  return context.json(await deps.speakers.importCsv(actor, eventId, body.csv))
}

/** PATCH /api/admin/events/:slug/speakers/:contactId */
export async function handlePatchSpeaker(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const contactId = context.req.param('contactId')
  if (slug === undefined || contactId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  if (typeof body.workflowStatus === 'string') {
    return context.json(
      await deps.speakers.setStatus(actor, eventId, contactId, body.workflowStatus),
    )
  }
  return context.json(
    await deps.speakers.updateOrganizerProfile(actor, eventId, contactId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      bio: typeof body.bio === 'string' || body.bio === null ? body.bio : undefined,
      jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle : undefined,
      company: typeof body.company === 'string' ? body.company : undefined,
      travelNotes: typeof body.travelNotes === 'string' ? body.travelNotes : undefined,
    }),
  )
}

/** POST /api/admin/events/:slug/speakers/:contactId/invite */
export async function handleInviteSpeaker(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const contactId = context.req.param('contactId')
  if (slug === undefined || contactId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const roster = await deps.speakers.listRoster(actor, eventId)
  const person = roster.find((row) => row.contactId === contactId)
  if (person === undefined) return notFoundResponse(context)
  await deps.capturedMessages.record({
    id: crypto.randomUUID(),
    eventId,
    toEmail: person.email,
    subject: `You're invited to speak`,
    body: `Welcome to the speaker portal. Sign in at /start with ${person.email}.`,
    createdAt: deps.clock.now(),
    kind: 'reminder',
  })
  return context.json({ sent: true, to: person.email })
}

/** GET /api/admin/events/:slug/speakers/templates */
export async function handleSpeakerMailTemplates(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  return context.json(deps.communications.speakerMailTemplates())
}

/** POST /api/admin/events/:slug/speakers/broadcast */
export async function handleBroadcastSpeakers(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.subject !== 'string' || typeof body.body !== 'string') {
    return validationFailedResponse(context)
  }
  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.filter((id): id is string => typeof id === 'string')
    : []
  if (body.preview === true) {
    return context.json(
      await deps.communications.previewSpeakerBroadcast(actor, eventId, {
        subject: body.subject,
        body: body.body,
        contactIds,
      }),
    )
  }
  return context.json(
    await deps.communications.sendSpeakerBroadcast(actor, eventId, {
      subject: body.subject,
      body: body.body,
      contactIds,
    }),
  )
}

/** PUT /api/admin/events/:slug/speakers/:contactId/headshot */
export async function handleUploadSpeakerHeadshot(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  if (deps.headshots === null) return notFoundResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const contactId = context.req.param('contactId')
  if (slug === undefined || contactId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const roster = await deps.speakers.listRoster(actor, eventId)
  if (!roster.some((person) => person.contactId === contactId)) return notFoundResponse(context)
  const contentType = (context.req.header('content-type') ?? '').split(';')[0]?.trim() ?? ''
  const declared = Number(context.req.header('content-length') ?? '')
  if (Number.isFinite(declared) && declared > HEADSHOT_MAX_BYTES) {
    return toErrorResponse(context, 'validation_failed', 413)
  }
  const bytes = await context.req.arrayBuffer()
  if (bytes.byteLength > HEADSHOT_MAX_BYTES) {
    return toErrorResponse(context, 'validation_failed', 413)
  }
  try {
    return context.json(
      await deps.headshots.storeForOwner(eventId, contactId, { contentType, bytes }),
    )
  } catch (error) {
    if (error instanceof HeadshotUnsupportedTypeError) {
      return toErrorResponse(context, 'validation_failed', 415)
    }
    if (error instanceof HeadshotTooLargeError) {
      return toErrorResponse(context, 'validation_failed', 413)
    }
    if (error instanceof HeadshotEmptyError) return validationFailedResponse(context)
    throw error
  }
}

/** GET /api/admin/events/:slug/embeds */
export async function handleListEmbeds(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const origin = new URL(context.req.url).origin
  return context.json(await deps.embeds.list(actor, slug, origin))
}

/** POST /api/admin/events/:slug/embeds */
export async function handleCreateEmbed(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.name !== 'string' || typeof body.kind !== 'string') {
    return validationFailedResponse(context)
  }
  const origin = new URL(context.req.url).origin
  return context.json(
    await deps.embeds.create(
      actor,
      slug,
      {
        name: body.name,
        kind: body.kind,
        format: typeof body.format === 'string' ? body.format : 'html',
        brandColor: typeof body.brandColor === 'string' ? body.brandColor : undefined,
        trackFilter: typeof body.trackFilter === 'string' ? body.trackFilter : undefined,
        enabled: body.enabled === false ? false : true,
      },
      origin,
    ),
    201,
  )
}

/** GET /api/admin/events/:slug/files */
export async function handleListFiles(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  return context.json(await deps.contentLibrary.listFiles(actor, slug))
}

/** POST /api/admin/events/:slug/files/zip */
export async function handleZipFiles(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  const owners = Array.isArray(body?.ownerContactIds)
    ? body.ownerContactIds.filter((id): id is string => typeof id === 'string')
    : []
  const zip = await deps.contentLibrary.zipLatest(actor, slug, owners)
  return new Response(Uint8Array.from(zip), {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="files.zip"',
    },
  })
}

/** PATCH /api/admin/events/:slug/submissions/:id/content */
export async function handleEditSessionContent(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('id')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.title !== 'string' || typeof body.abstract !== 'string') {
    return validationFailedResponse(context)
  }
  return context.json(
    await deps.contentLibrary.editSession(actor, slug, submissionId, {
      title: body.title,
      abstract: body.abstract,
      editorName: typeof body.editorName === 'string' ? body.editorName : 'Organizer',
    }),
  )
}

/** GET /api/admin/events/:slug/submissions/:id/revisions */
export async function handleListRevisions(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('id')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  return context.json(await deps.contentLibrary.listRevisions(actor, slug, submissionId))
}

/** POST /api/admin/events/:slug/revisions/:revisionId/restore */
export async function handleRestoreRevision(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const revisionId = context.req.param('revisionId')
  if (slug === undefined || revisionId === undefined) return notFoundResponse(context)
  return context.json(await deps.contentLibrary.restoreRevision(actor, slug, revisionId))
}

/** PUT /api/admin/events/:slug/submissions/:id/content-status */
export async function handleSetContentStatus(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('id')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.status !== 'string') return validationFailedResponse(context)
  return context.json(
    await deps.contentLibrary.setContentStatus(actor, slug, submissionId, body.status),
  )
}

/** GET/POST comments on a file */
export async function handleListFileComments(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const ownerContactId = context.req.param('ownerContactId')
  const kind = context.req.param('kind')
  if (slug === undefined || ownerContactId === undefined || kind === undefined) {
    return notFoundResponse(context)
  }
  if (kind !== 'document' && kind !== 'headshot') return validationFailedResponse(context)
  return context.json(await deps.contentLibrary.listComments(actor, slug, ownerContactId, kind))
}

export async function handleAddFileComment(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const ownerContactId = context.req.param('ownerContactId')
  const kind = context.req.param('kind')
  if (slug === undefined || ownerContactId === undefined || kind === undefined) {
    return notFoundResponse(context)
  }
  if (kind !== 'document' && kind !== 'headshot') return validationFailedResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.body !== 'string') return validationFailedResponse(context)
  return context.json(
    await deps.contentLibrary.addComment(actor, slug, {
      ownerContactId,
      kind,
      authorName: typeof body.authorName === 'string' ? body.authorName : 'Organizer',
      body: body.body,
    }),
    201,
  )
}

export async function handleListFileVersions(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const ownerContactId = context.req.param('ownerContactId')
  const kind = context.req.param('kind')
  if (slug === undefined || ownerContactId === undefined || kind === undefined) {
    return notFoundResponse(context)
  }
  if (kind !== 'document' && kind !== 'headshot') return validationFailedResponse(context)
  return context.json(await deps.contentLibrary.listVersions(actor, slug, ownerContactId, kind))
}

/** GET /api/admin/events/:slug/files/:ownerContactId/:kind */
export async function handleDownloadFile(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const ownerContactId = context.req.param('ownerContactId')
  const kind = context.req.param('kind')
  if (slug === undefined || ownerContactId === undefined || kind === undefined) {
    return notFoundResponse(context)
  }
  if (kind !== 'document' && kind !== 'headshot') return validationFailedResponse(context)
  const file = await deps.contentLibrary.getFile(actor, slug, ownerContactId, kind)
  if (file === null) return notFoundResponse(context)
  return new Response(file.body, {
    status: 200,
    headers: {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.fileName.replaceAll('"', '')}"`,
    },
  })
}

/** POST /api/admin/events/:slug/assignments */
export async function handleCreateSpeakerAssignment(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || typeof body.title !== 'string' || !Array.isArray(body.contactIds)) {
    return validationFailedResponse(context)
  }
  return context.json(
    await deps.assignments.create(actor, slug, {
      title: body.title,
      dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
      kind: typeof body.kind === 'string' ? body.kind : 'general',
      instructions: typeof body.instructions === 'string' ? body.instructions : '',
      contactIds: body.contactIds.filter((id): id is string => typeof id === 'string'),
    }),
    201,
  )
}

export async function handleListSpeakerAssignments(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  return context.json(await deps.assignments.list(actor, slug))
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

/**
 * PUT /api/admin/events/:slug/forms/:id/window — the organizer's own control over
 * when the call accepts proposals. Dates only: caps are a separate concern and
 * this route must not clear one it never asked about.
 */
export async function handleUpdateFormWindow(context: ServerContext): Promise<Response> {
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
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const opensAt = body.opensAt
  const closesAt = body.closesAt
  // Absent is not the same as null: a missing key would silently clear a date the
  // organizer never touched, so the shape is required and null is explicit.
  if (
    !(opensAt === null || typeof opensAt === 'string') ||
    !(closesAt === null || typeof closesAt === 'string')
  ) {
    return validationFailedResponse(context)
  }
  const summary = await deps.formBuilder.updateWindow(actor, eventId, formId, { opensAt, closesAt })
  return context.json(summary)
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

/**
 * POST /api/admin/submissions/:id/accept: idempotent acceptance + checklist.
 *
 * The decision is recorded alongside the acceptance so the two routes cannot
 * disagree: a proposal accepted here reads as accepted from the decision
 * surface and the speaker's portal, not merely as one with a checklist.
 */
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
  await deps.onboarding.decide(actor, eventId, submissionId, 'accepted')
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

/**
 * POST /api/admin/events/:slug/evaluations/committee: seat a reviewer on THIS
 * event's committee by email, creating the contact when nobody has ever used
 * it. Idempotent, and scoped to the one event named in the path.
 */
export async function handleAddCommitteeMember(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const email = body.email
  const name = body.name
  if (typeof email !== 'string') return validationFailedResponse(context)
  if (name !== undefined && typeof name !== 'string') return validationFailedResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  const input: AddCommitteeMemberInput = {
    email,
    ...(typeof name === 'string' ? { name } : {}),
  }
  const seated = await deps.evaluations.addCommitteeMember(actor, eventId, input)
  const invite = await sendReviewerInvite(context, deps, slug, email)
  return context.json({ ...seated, ...invite })
}

/**
 * GET /api/admin/events/:slug/evaluations/committee: the event's roster, each
 * seat carrying the member's identity and their workload.
 */
export async function handleListCommittee(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.listCommittee(actor, eventId))
}

/**
 * DELETE /api/admin/events/:slug/evaluations/committee/:contactId: give up one
 * seat on THIS event's committee.
 *
 * Idempotent: removing a seat nobody holds is the state the caller asked for,
 * not an error. The event scope is carried into the delete itself, so naming a
 * different event's slug removes nothing rather than reaching across.
 */
export async function handleRemoveCommitteeMember(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const contactId = context.req.param('contactId')
  if (slug === undefined || contactId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  await deps.evaluations.removeCommitteeMember(actor, eventId, contactId)
  return context.json({ removed: true })
}

/** GET /api/admin/events/:slug/submissions/:id/decision: the standing verdict. */
export async function handleGetSubmissionDecision(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('id')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.onboarding.getDecision(actor, eventId, submissionId))
}

/**
 * POST /api/admin/events/:slug/submissions/:id/decision: record Accept or
 * Reject. The verdict is the only thing in the body — the acting identity comes
 * from the session and the event from the path, and the service checks the
 * submission against that event in the same predicate that writes.
 */
export async function handleDecideSubmission(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('id')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  // An unrecognised verdict is refused outright rather than coerced: 'maybe'
  // must never quietly become a decision the speaker's portal then reports.
  if (!isSubmissionDecisionOutcome(body.decision)) return validationFailedResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.onboarding.decide(actor, eventId, submissionId, body.decision))
}

/**
 * POST /api/admin/events/:slug/submissions/:id/reject: the mirror of `accept`.
 * Both verdicts are reachable at the URL shape that names them, and both land
 * on the same append-only decision trail.
 */
export async function handleRejectSubmission(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const submissionId = context.req.param('id')
  if (slug === undefined || submissionId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.onboarding.decide(actor, eventId, submissionId, 'rejected'))
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

/**
 * PUT /api/admin/events/:slug/rounds/:roundId: the round's own configuration —
 * what it is called, when it runs, and whether it is blind. Not its status:
 * opening and closing is a transition with its own rule, not a form field.
 */
export async function handleConfigureRound(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const roundId = context.req.param('roundId')
  if (slug === undefined || roundId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  if (typeof body.name !== 'string') return validationFailedResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(
    await deps.evaluations.configureRound(actor, eventId, roundId, {
      name: body.name,
      opensAt: typeof body.opensAt === 'string' || body.opensAt === null ? body.opensAt : null,
      closesAt: typeof body.closesAt === 'string' || body.closesAt === null ? body.closesAt : null,
      anonymize: body.anonymize === true,
    }),
  )
}

/** GET /api/admin/events/:slug/rounds/:roundId/scorecard: what this round asks. */
export async function handleGetRoundScorecard(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const roundId = context.req.param('roundId')
  if (slug === undefined || roundId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.getRoundScorecard(actor, eventId, roundId))
}

/** PUT .../scorecard: replaces the round's questions wholesale. */
export async function handlePutRoundScorecard(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const roundId = context.req.param('roundId')
  if (slug === undefined || roundId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || !Array.isArray(body.criteria)) return validationFailedResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(
    await deps.evaluations.putRoundScorecard(
      actor,
      eventId,
      roundId,
      body.criteria as readonly RoundCriterionInput[],
    ),
  )
}

/** GET .../pool: which committee members read in this round. */
export async function handleGetRoundPool(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const roundId = context.req.param('roundId')
  if (slug === undefined || roundId === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.getRoundPool(actor, eventId, roundId))
}

/** PUT .../pool: sets the round's reviewers, all of whom must hold a seat. */
export async function handlePutRoundPool(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const roundId = context.req.param('roundId')
  if (slug === undefined || roundId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null || !Array.isArray(body.contactIds)) return validationFailedResponse(context)
  if (!body.contactIds.every((id) => typeof id === 'string')) {
    return validationFailedResponse(context)
  }
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(
    await deps.evaluations.putRoundPool(actor, eventId, roundId, body.contactIds as string[]),
  )
}

/**
 * POST .../evaluations/committee/remind: nudge the reviewers who still owe
 * reviews. An empty or absent list means everyone who is behind.
 */
export async function handleRemindReviewers(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const contactIds = body.contactIds
  if (contactIds !== undefined) {
    if (!Array.isArray(contactIds) || !contactIds.every((id) => typeof id === 'string')) {
      return validationFailedResponse(context)
    }
  }
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(
    await deps.evaluations.remindReviewers(actor, eventId, {
      ...(Array.isArray(contactIds) ? { contactIds: contactIds as string[] } : {}),
    }),
  )
}

/**
 * POST .../rounds/:roundId/distribute: shares this round's reading out among
 * its reviewers in one action, within an optional per-reviewer cap and an
 * optional single track.
 */
export async function handleDistributeRound(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  const roundId = context.req.param('roundId')
  if (slug === undefined || roundId === undefined) return notFoundResponse(context)
  const body = await readJsonBody(context)
  if (body === null) return validationFailedResponse(context)
  const perReviewerCap = body.perReviewerCap
  const track = body.track
  const readersPerSubmission = body.readersPerSubmission
  if (
    perReviewerCap !== undefined &&
    perReviewerCap !== null &&
    typeof perReviewerCap !== 'number'
  ) {
    return validationFailedResponse(context)
  }
  if (track !== undefined && track !== null && typeof track !== 'string') {
    return validationFailedResponse(context)
  }
  if (readersPerSubmission !== undefined && typeof readersPerSubmission !== 'number') {
    return validationFailedResponse(context)
  }
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(
    await deps.evaluations.distributeRound(actor, eventId, roundId, {
      ...(typeof perReviewerCap === 'number' ? { perReviewerCap } : {}),
      ...(typeof track === 'string' ? { track } : {}),
      ...(typeof readersPerSubmission === 'number' ? { readersPerSubmission } : {}),
    }),
  )
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
  const assignment = await deps.evaluations.assign(actor, eventId, submissionId, input)
  const invite = await sendReviewerInvite(context, deps, slug, evaluatorEmail)
  return context.json({ ...assignment, ...invite })
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

/**
 * GET /api/admin/events/:slug/results — every proposal with what the committee
 * scored it, for the results table. Read-only and organizer-only, like its
 * per-submission sibling.
 */
export async function handleEvaluationResults(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const actor = requireOrganizer(context)
  if (actor === null) return forbiddenResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const eventId = await resolveEventId(deps, slug)
  if (eventId === null) return notFoundResponse(context)
  return context.json(await deps.evaluations.resultsForEvent(actor, eventId))
}

/** Registers the admin surface; CSRF runs before session validation on mutations. */
export function registerAdminRoutes(app: Hono<ServerEnv>): void {
  app.post('/api/admin/session', handleAdminSession)
  app.post('/api/admin/session/clerk', handleAdminClerkSession)

  app.get('/api/admin/events', requireSession(), requireActor('organizer'), handleListEvents)
  app.post(
    '/api/admin/events',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleCreateEvent,
  )

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
    '/api/admin/events/:slug/agenda/auto-place',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAutoPlaceAgenda,
  )
  app.post(
    '/api/admin/events/:slug/agenda/publish',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handlePublishAgenda,
  )
  app.get(
    '/api/admin/events/:slug/messages',
    requireSession(),
    requireActor('organizer'),
    handleListMessages,
  )
  app.get(
    '/api/admin/events/:slug/speakers',
    requireSession(),
    requireActor('organizer'),
    handleListSpeakers,
  )
  app.post(
    '/api/admin/events/:slug/speakers',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAddSpeaker,
  )
  app.post(
    '/api/admin/events/:slug/speakers/import',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleImportSpeakers,
  )
  app.get(
    '/api/admin/events/:slug/speakers/templates',
    requireSession(),
    requireActor('organizer'),
    handleSpeakerMailTemplates,
  )
  app.post(
    '/api/admin/events/:slug/speakers/broadcast',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleBroadcastSpeakers,
  )
  app.patch(
    '/api/admin/events/:slug/speakers/:contactId',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handlePatchSpeaker,
  )
  app.post(
    '/api/admin/events/:slug/speakers/:contactId/invite',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleInviteSpeaker,
  )
  app.put(
    '/api/admin/events/:slug/speakers/:contactId/headshot',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleUploadSpeakerHeadshot,
  )
  app.get(
    '/api/admin/events/:slug/embeds',
    requireSession(),
    requireActor('organizer'),
    handleListEmbeds,
  )
  app.post(
    '/api/admin/events/:slug/embeds',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleCreateEmbed,
  )
  app.get(
    '/api/admin/events/:slug/files',
    requireSession(),
    requireActor('organizer'),
    handleListFiles,
  )
  app.post(
    '/api/admin/events/:slug/files/zip',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleZipFiles,
  )
  app.get(
    '/api/admin/events/:slug/files/:ownerContactId/:kind',
    requireSession(),
    requireActor('organizer'),
    handleDownloadFile,
  )
  app.get(
    '/api/admin/events/:slug/files/:ownerContactId/:kind/versions',
    requireSession(),
    requireActor('organizer'),
    handleListFileVersions,
  )
  app.get(
    '/api/admin/events/:slug/files/:ownerContactId/:kind/comments',
    requireSession(),
    requireActor('organizer'),
    handleListFileComments,
  )
  app.post(
    '/api/admin/events/:slug/files/:ownerContactId/:kind/comments',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAddFileComment,
  )
  app.get(
    '/api/admin/events/:slug/assignments',
    requireSession(),
    requireActor('organizer'),
    handleListSpeakerAssignments,
  )
  app.post(
    '/api/admin/events/:slug/assignments',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleCreateSpeakerAssignment,
  )
  app.patch(
    '/api/admin/events/:slug/submissions/:id/content',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleEditSessionContent,
  )
  app.get(
    '/api/admin/events/:slug/submissions/:id/revisions',
    requireSession(),
    requireActor('organizer'),
    handleListRevisions,
  )
  app.put(
    '/api/admin/events/:slug/submissions/:id/content-status',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleSetContentStatus,
  )
  app.post(
    '/api/admin/events/:slug/revisions/:revisionId/restore',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleRestoreRevision,
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
  app.put(
    '/api/admin/events/:slug/rounds/:roundId',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleConfigureRound,
  )
  app.get(
    '/api/admin/events/:slug/rounds/:roundId/scorecard',
    requireSession(),
    requireActor('organizer'),
    handleGetRoundScorecard,
  )
  app.put(
    '/api/admin/events/:slug/rounds/:roundId/scorecard',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handlePutRoundScorecard,
  )
  app.get(
    '/api/admin/events/:slug/rounds/:roundId/pool',
    requireSession(),
    requireActor('organizer'),
    handleGetRoundPool,
  )
  app.put(
    '/api/admin/events/:slug/rounds/:roundId/pool',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handlePutRoundPool,
  )
  app.post(
    '/api/admin/events/:slug/evaluations/committee/remind',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleRemindReviewers,
  )
  app.post(
    '/api/admin/events/:slug/rounds/:roundId/distribute',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleDistributeRound,
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
  app.get(
    '/api/admin/events/:slug/results',
    requireSession(),
    requireActor('organizer'),
    handleEvaluationResults,
  )
  app.post(
    '/api/admin/events/:slug/evaluations/committee',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleAddCommitteeMember,
  )
  app.get(
    '/api/admin/events/:slug/evaluations/committee',
    requireSession(),
    requireActor('organizer'),
    handleListCommittee,
  )
  app.delete(
    '/api/admin/events/:slug/evaluations/committee/:contactId',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleRemoveCommitteeMember,
  )
  app.get(
    '/api/admin/events/:slug/submissions/:id/decision',
    requireSession(),
    requireActor('organizer'),
    handleGetSubmissionDecision,
  )
  app.post(
    '/api/admin/events/:slug/submissions/:id/decision',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleDecideSubmission,
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
    '/api/admin/events/:slug/submissions/:id/reject',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleRejectSubmission,
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
  app.put(
    '/api/admin/events/:slug/forms/:id/window',
    csrfGate(),
    requireSession(),
    requireActor('organizer'),
    handleUpdateFormWindow,
  )
}
