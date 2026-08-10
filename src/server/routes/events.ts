import { depsFromContext } from '../container'
import type { ServerContext } from '../env'
import { databaseUnavailableResponse } from '../env'
import { notFoundResponse } from '../error'

/** GET /api/events/:slug handler (legacy slice, standardized to the envelope). */
export async function handleGetEvent(context: ServerContext): Promise<Response> {
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const slug = context.req.param('slug')
  if (slug === undefined) return notFoundResponse(context)
  const event = await deps.getEvent.executeBySlug({ slug })
  return event === null ? notFoundResponse(context) : context.json(event)
}
