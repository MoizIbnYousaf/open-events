import { ApiClientError } from './admin-events'

export type TourSessionStart =
  | {
      readonly mode: 'ready'
      readonly expiresAt: string
      readonly eventSlug: string
    }
  | { readonly mode: 'redirect'; readonly url: string }

export type TourAccess = 'organizer' | 'portal' | 'evaluation'

async function tourRequest(
  method: 'POST' | 'DELETE',
  access?: TourAccess,
  keepalive = false,
): Promise<Response> {
  const response = await fetch('/api/tour/session', {
    method,
    credentials: 'include',
    headers: access === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: access === undefined ? undefined : JSON.stringify({ access }),
    keepalive,
  })
  if (!response.ok) {
    throw new ApiClientError('internal', 'The guided tour could not start.', response.status)
  }
  return response
}

/** Opens short-lived, role-scoped authority in the isolated tour sandbox. */
export async function startTourSession(
  access: TourAccess = 'organizer',
): Promise<TourSessionStart> {
  const response = await tourRequest('POST', access)
  return (await response.json()) as TourSessionStart
}

/** Drops tour authority before public screens and whenever the tour closes. */
export async function endTourSession(
  options: { readonly keepalive?: boolean } = {},
): Promise<void> {
  await tourRequest('DELETE', undefined, options.keepalive ?? false)
}
