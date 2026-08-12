import { depsFromContext } from '../container'
import type { ServerContext } from '../env'
import { databaseUnavailableResponse } from '../env'
import { notFoundResponse } from '../error'

/**
 * GET /api/public/events/:slug/schedule — the published-only, PII-stripped
 * schedule envelope for the public programme. Read-only (SELECT statements
 * only), track/room rendered as labels, cacheable for 60 seconds.
 *
 * Two conditions decide what the public sees, and both are checked HERE. A
 * session must be published, and its submission must not stand rejected.
 * Publishing already refuses a rejected talk, but a talk can be published first
 * and rejected afterwards — and a rejection deliberately leaves the agenda row
 * and the acceptance record in place, because onboarding work hangs off them.
 * So the agenda row alone can never answer 'is this on the programme', and this
 * is the one surface an anonymous visitor reaches.
 */
export async function handleGetPublicSchedule(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined || slug.length === 0) return notFoundResponse(context)
  const event = await deps.getEvent.executeBySlug({ slug })
  if (event === null) return notFoundResponse(context)

  const [stored, decisions] = await Promise.all([
    deps.agenda.listByEvent(event.id),
    deps.submissions.listDecisionsByEvent(event.id),
  ])
  // `listDecisionsByEvent` returns the STANDING verdict per submission, so a
  // rejection that was later reversed correctly leaves the talk on the
  // programme rather than hiding it forever.
  const rejected = new Set(
    decisions
      .filter((decision) => decision.outcome === 'rejected')
      .map((decision) => decision.submissionId),
  )
  const sessions = stored.filter(
    (session) => session.status === 'published' && !rejected.has(session.submissionId),
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
