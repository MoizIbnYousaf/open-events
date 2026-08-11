import type {
  AdminEventConfigDto,
  FormSummaryDto,
  TaxonomyItemInput,
  TaxonomyListDto,
  UpdateEventConfigInput,
} from '../../application'
import type { EventSlug } from '../../domain'

/** Error carrying the safe server envelope for API responses. */
export class ApiClientError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
  }
}

function isApiErrorBody(body: unknown): body is { error: { code: string; message: string } } {
  if (typeof body !== 'object' || body === null) return false
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return false
  const record = error as Record<string, unknown>
  return typeof record.code === 'string' && typeof record.message === 'string'
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    if (isApiErrorBody(body)) {
      throw new ApiClientError(body.error.code, body.error.message, response.status)
    }
    throw new ApiClientError('internal', 'Request failed', response.status)
  }
  return (await response.json()) as T
}

export function getApiErrorCode(error: unknown): string | null {
  return error instanceof ApiClientError ? error.code : null
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback
}

/** POST /api/admin/session: exchanges the dev secret for an HttpOnly cookie. */
export function adminLogin(secret: string): Promise<{ readonly expiresAt: string }> {
  return requestJson('/api/admin/session', { method: 'POST', body: JSON.stringify({ secret }) })
}

/** GET /api/admin/events/:slug */
export function getEventConfig(slug: EventSlug): Promise<AdminEventConfigDto> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}`)
}

/** PATCH /api/admin/events/:slug (partial; omitted fields keep their value). */
export function updateEventConfig(
  slug: EventSlug,
  input: UpdateEventConfigInput,
): Promise<AdminEventConfigDto> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

/** GET /api/admin/events/:slug/forms */
export function listForms(slug: EventSlug): Promise<readonly FormSummaryDto[]> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/forms`)
}

/** GET /api/admin/events/:slug/taxonomies */
export function getTaxonomies(slug: EventSlug): Promise<TaxonomyListDto> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/taxonomies`)
}

/** PUT /api/admin/events/:slug/taxonomies (full replace; ids are server-generated). */
export function replaceTaxonomies(
  slug: EventSlug,
  items: readonly TaxonomyItemInput[],
): Promise<TaxonomyListDto> {
  return requestJson(`/api/admin/events/${encodeURIComponent(slug)}/taxonomies`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
}
