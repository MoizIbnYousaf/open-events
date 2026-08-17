import type { Hono } from 'hono'

import { MAX_ORGANIZER_SESSION_TTL_MS } from '../../application/security/token-policy'
import { createSha256TokenHasher } from '../../application/security/webcrypto'
import { addMillis } from '../../application/time'
import { depsFromContext } from '../container'
import { csrfGate } from '../csrf'
import {
  ConfigError,
  databaseUnavailableResponse,
  getTtlConfig,
  getDatabaseBinding,
  type ServerContext,
  type ServerEnv,
} from '../env'
import { notFoundResponse } from '../error'
import {
  readTourSessionToken,
  serializeExpiredTourSessionCookie,
  serializeTourSessionCookie,
  sessionCookieMaxAgeSeconds,
} from '../auth'

const TOUR_EVENT_SLUG = 'demo-conf-2026'
const TOUR_EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const TOUR_SPEAKER_CONTACT_ID = 'd0000000-0000-4000-8000-000000000610'
const TOUR_REVIEWER_CONTACT_ID = 'c0000000-0000-4000-8000-000000000601'
const TOUR_SESSION_TTL_MS = 10 * 60 * 1000
type TourAccess = 'organizer' | 'portal' | 'evaluation'

function secureRequest(context: ServerContext): boolean {
  return new URL(context.req.url).protocol === 'https:'
}

function productionTourUrl(context: ServerContext): string {
  const raw = context.env.TOUR_APP_URL
  if (raw === undefined || raw.length === 0) {
    throw new ConfigError('Tour sandbox URL is not configured')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError('Tour sandbox URL is invalid')
  }
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ConfigError('Tour sandbox URL is invalid')
  }
  url.pathname = '/'
  url.searchParams.set('tour', '1')
  return url.toString()
}

/**
 * Starts the guided demo. Production never mints organizer authority: it hands
 * the browser to the isolated acceptance Worker. Acceptance and local test
 * environments issue a regular, short-lived organizer session against their
 * own disposable D1 data, so every admin screen behaves exactly as it does for
 * a real organizer without exposing the production database.
 */
async function requestedAccess(context: ServerContext): Promise<TourAccess | null> {
  const contentType = context.req.header('Content-Type') ?? ''
  if (!contentType.includes('application/json')) return 'organizer'
  let body: unknown
  try {
    body = await context.req.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || !('access' in body)) return null
  const access = (body as { readonly access?: unknown }).access
  return access === 'organizer' || access === 'portal' || access === 'evaluation' ? access : null
}

async function issueSubmitterTourSession(
  context: ServerContext,
  access: Exclude<TourAccess, 'organizer'>,
  ttlMs: number,
): Promise<{ readonly token: string; readonly expiresAt: string } | null> {
  const db = getDatabaseBinding(context)
  const deps = depsFromContext(context)
  if (db === null || deps === null) return null
  const token = crypto.randomUUID()
  const tokenHash = await createSha256TokenHasher().hash(token)
  const now = deps.clock.now()
  const expiresAt = addMillis(now, ttlMs)
  const contactId = access === 'portal' ? TOUR_SPEAKER_CONTACT_ID : TOUR_REVIEWER_CONTACT_ID
  const proof =
    access === 'portal'
      ? `EXISTS (
          SELECT 1 FROM submission_contributors sc
          JOIN submission_acceptances sa
            ON sa.event_id = sc.event_id AND sa.submission_id = sc.submission_id
          WHERE sc.event_id = ? AND sc.contact_id = ?
        )`
      : `EXISTS (
          SELECT 1 FROM evaluation_committee_members cm
          WHERE cm.event_id = ? AND cm.contact_id = ?
        )`
  const inserted = await db
    .prepare(
      `INSERT INTO sessions
         (id, kind, contact_id, event_id, capability, token_hash, expires_at, consumed_at, created_at, provenance)
       SELECT ?, 'submitter', ?, ?, ?, ?, ?, NULL, ?, 'tour'
       WHERE ${proof}`,
    )
    .bind(
      crypto.randomUUID(),
      contactId,
      TOUR_EVENT_ID,
      access,
      tokenHash,
      expiresAt,
      now,
      TOUR_EVENT_ID,
      contactId,
    )
    .run()
  return inserted.meta.changes === 1 ? { token, expiresAt } : null
}

async function handleStartTourSession(context: ServerContext): Promise<Response> {
  const environment = context.env.DEPLOY_ENVIRONMENT
  context.header('Cache-Control', 'no-store')

  if (environment === 'production') {
    return context.json({ mode: 'redirect', url: productionTourUrl(context) })
  }
  if (!['acceptance', 'local', 'test'].includes(environment ?? '')) {
    return notFoundResponse(context)
  }

  const access = await requestedAccess(context)
  if (access === null) {
    return context.json(
      { error: { code: 'validation_failed', message: 'Invalid tour access' } },
      400,
    )
  }

  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const previousTourToken = readTourSessionToken(context)
  if (previousTourToken !== null) await deps.session.revokeSession(previousTourToken)
  const configuredTtl = getTtlConfig(context).organizerSessionMs
  const ttlMs = Math.min(configuredTtl, TOUR_SESSION_TTL_MS, MAX_ORGANIZER_SESSION_TTL_MS)
  const result =
    access === 'organizer'
      ? await deps.session.issueOrganizerSession(ttlMs, 'tour')
      : await issueSubmitterTourSession(context, access, ttlMs)
  if (result === null) {
    return context.json({ error: { code: 'internal', message: 'tour_fixture_unavailable' } }, 500)
  }
  const maxAge = sessionCookieMaxAgeSeconds(result.expiresAt, deps.clock.now())
  context.header(
    'Set-Cookie',
    serializeTourSessionCookie(result.token, maxAge, secureRequest(context)),
  )
  return context.json({
    mode: 'ready',
    expiresAt: result.expiresAt,
    eventSlug: TOUR_EVENT_SLUG,
  })
}

/** Drops the sandbox organizer cookie when the tour enters public screens or closes. */
async function handleEndTourSession(context: ServerContext): Promise<Response> {
  const environment = context.env.DEPLOY_ENVIRONMENT
  if (!['acceptance', 'local', 'test'].includes(environment ?? '')) {
    return notFoundResponse(context)
  }
  context.header('Cache-Control', 'no-store')
  const deps = depsFromContext(context)
  if (deps === null) return databaseUnavailableResponse(context)
  const token = readTourSessionToken(context)
  if (token !== null) await deps.session.revokeSession(token)
  context.header('Set-Cookie', serializeExpiredTourSessionCookie(secureRequest(context)))
  return context.body(null, 204)
}

export function registerTourRoutes(app: Hono<ServerEnv>): void {
  app.post('/api/tour/session', csrfGate(), handleStartTourSession)
  app.delete('/api/tour/session', csrfGate(), handleEndTourSession)
}
