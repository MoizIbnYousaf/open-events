import {
  applySessionCardsToPeople,
  isPubliclyVisible,
  toPublicSessions,
  toPublicSpeakers,
} from '../../application/services/public-programme'
import { toIcsCalendar } from '../../domain/calendar'
import type { ProgrammeRepository } from '../../application/ports/programme-repository'
import type { EventId, SubmissionId } from '../../domain'
import { latestApprovedSnapshot } from '../../domain/session-content'
import { depsFromContext } from '../container'
import type { ServerContext } from '../env'
import { databaseUnavailableResponse } from '../env'
import { notFoundResponse, validationFailedResponse } from '../error'

/**
 * GET /api/public/events/:slug/schedule — the published-only, PII-stripped
 * schedule envelope for the public programme. Read-only, track/room rendered
 * as labels, cacheable for 60 seconds.
 */
export async function handleGetPublicSchedule(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined || slug.length === 0) return notFoundResponse(context)
  const event = await deps.getEvent.executeBySlug({ slug })
  if (event === null) return notFoundResponse(context)

  const [stored, decisions, submissions, items, statuses] = await Promise.all([
    deps.agenda.listByEvent(event.id),
    deps.submissions.listDecisionsByEvent(event.id),
    deps.submissions.listByEvent(event.id),
    deps.taxonomies.listByEvent(event.id),
    deps.programme.listContentStatuses(event.id),
  ])
  const rejected = new Set<string>()
  for (const decision of decisions) {
    if (decision.outcome === 'rejected') rejected.add(decision.submissionId)
  }
  const contentStatus = new Map(statuses.map((row) => [row.submissionId, row.status]))
  const { approvedSnapshots, approvedCopy } = await loadApprovedCopy(
    deps.programme,
    event.id,
    submissions.map((row) => row.id),
  )
  const labelByTaxonomyId = new Map(items.map((item) => [item.id, item.label]))
  const publicSessions = await toPublicSessions({
    sessions: stored,
    submissions,
    rejected,
    contentStatus,
    approvedSnapshots,
    approvedCopy,
    labelByTaxonomyId,
    contacts: deps.contacts,
    formContent: deps.formContent,
    profiles: deps.programme,
  })

  return context.json({ timezone: event.timezone, sessions: publicSessions }, 200, {
    'Cache-Control': 'public, max-age=60',
  })
}

/** GET /api/public/events/:slug/speakers */
export async function handleGetPublicSpeakers(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined || slug.length === 0) return notFoundResponse(context)
  const event = await deps.getEvent.executeBySlug({ slug })
  if (event === null) return notFoundResponse(context)
  const [stored, decisions, submissions, items, statuses, roster] = await Promise.all([
    deps.agenda.listByEvent(event.id),
    deps.submissions.listDecisionsByEvent(event.id),
    deps.submissions.listByEvent(event.id),
    deps.taxonomies.listByEvent(event.id),
    deps.programme.listContentStatuses(event.id),
    deps.contacts.listSpeakersByEvent(event.id),
  ])
  const rejected = new Set<string>()
  for (const decision of decisions) {
    if (decision.outcome === 'rejected') rejected.add(decision.submissionId)
  }
  const contentStatus = new Map(statuses.map((row) => [row.submissionId, row.status]))
  const { approvedSnapshots, approvedCopy } = await loadApprovedCopy(
    deps.programme,
    event.id,
    submissions.map((row) => row.id),
  )
  const sessions = await toPublicSessions({
    sessions: stored,
    submissions,
    rejected,
    contentStatus,
    approvedSnapshots,
    approvedCopy,
    labelByTaxonomyId: new Map(items.map((item) => [item.id, item.label])),
    contacts: deps.contacts,
    formContent: deps.formContent,
    profiles: deps.programme,
  })
  const visibleIds = new Set<string>()
  for (const session of stored) {
    if (!isPubliclyVisible(session, rejected, contentStatus, approvedSnapshots)) continue
    for (const speakerId of session.speakerIds) visibleIds.add(speakerId)
  }
  const rosterById = new Map(roster.map((row) => [row.contactId, row]))
  const people = await Promise.all(
    [...visibleIds].map(async (contactId) => {
      const row = rosterById.get(contactId)
      const contact = row === undefined ? await deps.contacts.findById(contactId) : null
      return {
        id: contactId,
        name: row?.name ?? contact?.name ?? '',
        bio: row?.bio ?? contact?.bio ?? '',
        // Uploads are private by default. Public imagery requires an explicit
        // checksum-bound human review; until that review workflow is present,
        // initials are the only safe public representation.
        hasHeadshot: false,
        jobTitle: row?.jobTitle ?? '',
        company: row?.company ?? '',
      }
    }),
  )
  return context.json(
    { speakers: toPublicSpeakers(sessions, applySessionCardsToPeople(people, sessions), slug) },
    200,
    {
      'Cache-Control': 'public, max-age=60',
    },
  )
}

/** GET /api/public/events/:slug/speakers/:contactId */
export async function handleGetPublicSpeaker(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const slug = context.req.param('slug')
  const contactId = context.req.param('contactId')
  if (slug === undefined || contactId === undefined) return notFoundResponse(context)
  const list = await handleGetPublicSpeakers(context)
  if (list.status !== 200) return list
  const body = (await list.json()) as { speakers: Array<{ id: string }> }
  const speaker = body.speakers.find((person) => person.id === contactId)
  return speaker === undefined ? notFoundResponse(context) : context.json(speaker)
}

/** GET /api/public/events/:slug/speakers/:contactId/headshot */
export async function handleGetPublicSpeakerHeadshot(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  if (deps.headshots === null) return notFoundResponse(context)
  const slug = context.req.param('slug')
  const contactId = context.req.param('contactId')
  if (slug === undefined || contactId === undefined) return notFoundResponse(context)
  const list = await handleGetPublicSpeakers(context)
  if (list.status !== 200) return list
  const body = (await list.json()) as { speakers: Array<{ id: string; hasHeadshot: boolean }> }
  const speaker = body.speakers.find((person) => person.id === contactId)
  if (speaker === undefined || !speaker.hasHeadshot) return notFoundResponse(context)
  const event = await deps.getEvent.executeBySlug({ slug })
  if (event === null) return notFoundResponse(context)
  const headshot = await deps.headshots.getForOwner(event.id, contactId)
  if (headshot === null) return notFoundResponse(context)
  return new Response(headshot.body, {
    status: 200,
    headers: {
      'content-type': headshot.contentType,
      'cache-control': 'public, max-age=60',
    },
  })
}

/** GET /api/public/events/:slug/schedule.ics */
export async function handleGetPublicIcs(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const event = await deps.getEvent.executeBySlug({ slug })
  if (event === null) return notFoundResponse(context)
  const schedule = await handleGetPublicSchedule(context)
  if (schedule.status !== 200) return schedule
  const body = (await schedule.json()) as {
    sessions: Array<{
      submissionId: string
      title: string
      start: string
      end: string
      room: string
      description: string
    }>
  }
  const requested = context.req.query('ids')
  let selected = body.sessions
  if (requested !== undefined) {
    const ids = [...new Set(requested.split(',').filter((id) => id !== ''))]
    if (
      ids.length === 0 ||
      ids.length > 64 ||
      ids.some((id) => id.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(id))
    ) {
      return validationFailedResponse(context)
    }
    const allowed = new Set(ids)
    selected = body.sessions.filter((session) => allowed.has(session.submissionId))
  }
  const ics = toIcsCalendar(
    event.name,
    selected.map((session) => ({
      uid: `${session.submissionId}@open-events`,
      title: session.title,
      start: session.start,
      end: session.end,
      location: session.room,
      description: session.description,
    })),
  )
  return new Response(ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': requested === undefined ? 'public, max-age=60' : 'private, max-age=60',
    },
  })
}

async function loadApprovedCopy(
  programme: ProgrammeRepository,
  eventId: EventId,
  submissionIds: readonly SubmissionId[],
): Promise<{
  readonly approvedSnapshots: ReadonlySet<string>
  readonly approvedCopy: ReadonlyMap<string, { readonly title: string; readonly abstract: string }>
}> {
  const approvedSnapshots = new Set<string>()
  const approvedCopy = new Map<string, { readonly title: string; readonly abstract: string }>()
  await Promise.all(
    submissionIds.map(async (submissionId) => {
      const revisions = await programme.listRevisions(eventId, submissionId)
      const last = latestApprovedSnapshot(revisions)
      if (last === null) return
      approvedSnapshots.add(submissionId)
      approvedCopy.set(submissionId, last)
    }),
  )
  return { approvedSnapshots, approvedCopy }
}
