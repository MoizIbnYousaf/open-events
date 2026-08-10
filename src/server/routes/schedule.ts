import { depsFromContext } from '../container'
import type { ServerContext } from '../env'
import { databaseUnavailableResponse } from '../env'
import { notFoundResponse } from '../error'

/**
 * GET /api/public/events/:slug/schedule — the published-only, PII-stripped
 * schedule envelope for the public programme. Read-only (SELECT statements
 * only), track/room rendered as labels, cacheable for 60 seconds.
 */
export async function handleGetPublicSchedule(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined || slug.length === 0) return notFoundResponse(context)
  const event = await deps.getEvent.executeBySlug({ slug })
  if (event === null) return notFoundResponse(context)

  const sessions = (await deps.agenda.listByEvent(event.id)).filter(
    (session) => session.status === 'published',
  )
  const submissions = await deps.submissions.listByEvent(event.id)
  const titleBySubmissionId = new Map(
    submissions.map((submission) => [submission.id, submission.title]),
  )
  const items = await deps.taxonomies.listByEvent(event.id)
  const labelByTaxonomyId = new Map(items.map((item) => [item.id, item.label]))

  const publicSessions = sessions.map((session) => ({
    submissionId: session.submissionId,
    title: titleBySubmissionId.get(session.submissionId) ?? '',
    track: session.trackId === null ? '' : (labelByTaxonomyId.get(session.trackId) ?? ''),
    room: session.roomId === null ? '' : (labelByTaxonomyId.get(session.roomId) ?? ''),
    day: session.day,
    start: session.start,
    end: session.end,
    position: session.position,
  }))

  return context.json({ timezone: event.timezone, sessions: publicSessions }, 200, {
    'Cache-Control': 'public, max-age=60',
  })
}
