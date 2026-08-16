import { Resend } from 'resend'
import type { Hono } from 'hono'

import {
  RESEND_DELIVERY_EVENT_TYPES,
  type ResendDeliveryEventType,
} from '../../application/ports/email-delivery-webhook-repository'
import { createEmailDeliveryWebhookRepository } from '../../db/email-delivery-webhook-repository'
import type { ServerContext, ServerEnv } from '../env'
import { databaseUnavailableResponse, getDatabaseBinding } from '../env'
import { rateLimitedResponse, toErrorResponse, validationFailedResponse } from '../error'
import { clientAddress, consumeEdgeLimit, durableLimitKey } from '../rate-limit'

const MAX_WEBHOOK_BYTES = 64 * 1024
const MAX_HEADER_BYTES = 512
const MAX_IDENTIFIER_BYTES = 256
const JOB_TAG = 'open_events_job'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function isDeliveryEventType(value: unknown): value is ResendDeliveryEventType {
  return (
    typeof value === 'string' && (RESEND_DELIVERY_EVENT_TYPES as readonly string[]).includes(value)
  )
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

async function readCappedText(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) return null
  const reader = request.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_WEBHOOK_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

async function sourceAllowed(context: ServerContext): Promise<boolean> {
  const source = clientAddress(context)
  if (source === null) return true
  const key = await durableLimitKey(context, 'resend-webhook-source', source)
  if (key === null) return false
  return consumeEdgeLimit(context, 'RESEND_WEBHOOK_RATE_LIMITER', key)
}

/**
 * Signed raw-body Resend callback. This is the sole mutation endpoint whose
 * authorization is the Standard Webhooks signature instead of cookie + CSRF.
 */
export async function handleResendWebhook(context: ServerContext): Promise<Response> {
  const secret = context.env.RESEND_WEBHOOK_SECRET ?? ''
  if (secret.length === 0) {
    return context.json({ error: { code: 'internal', message: 'webhook_unavailable' } }, 503)
  }
  if (!(await sourceAllowed(context))) return rateLimitedResponse(context, '60')

  const mediaType = (context.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') return toErrorResponse(context, 'validation_failed', 415)
  const id = boundedString(context.req.header('svix-id'), MAX_HEADER_BYTES)
  const timestamp = boundedString(context.req.header('svix-timestamp'), MAX_HEADER_BYTES)
  const signature = boundedString(context.req.header('svix-signature'), MAX_HEADER_BYTES)
  if (id === null || timestamp === null || signature === null) {
    return validationFailedResponse(context)
  }

  const rawBody = await readCappedText(context.req.raw)
  if (rawBody === null) return toErrorResponse(context, 'validation_failed', 413)

  let verified: unknown
  try {
    verified = new Resend('re_webhook_verifier').webhooks.verify({
      payload: rawBody,
      headers: { id, timestamp, signature },
      webhookSecret: secret,
    })
  } catch {
    return validationFailedResponse(context)
  }
  if (!isRecord(verified)) return validationFailedResponse(context)
  // Resend retries every non-2xx response. Authenticated event families this
  // application does not project are intentionally acknowledged and ignored.
  if (!isDeliveryEventType(verified.type)) return context.json({ received: true })

  const data = verified.data
  const createdAt = canonicalInstant(verified.created_at)
  if (!isRecord(data) || createdAt === null) return validationFailedResponse(context)
  const providerEmailId = boundedString(data.email_id, MAX_IDENTIFIER_BYTES)
  if (providerEmailId === null) return validationFailedResponse(context)
  const tags = isRecord(data.tags) ? data.tags : null
  const jobTag = boundedString(tags?.[JOB_TAG], MAX_IDENTIFIER_BYTES)

  const db = getDatabaseBinding(context)
  if (db === null) return databaseUnavailableResponse(context)
  const result = await createEmailDeliveryWebhookRepository(db).record({
    id,
    providerEmailId,
    jobTag,
    type: verified.type,
    createdAt,
    receivedAt: new Date().toISOString(),
  })
  return context.json({ received: true, matched: result.matched })
}

export function registerResendWebhookRoutes(app: Hono<ServerEnv>): void {
  app.post('/api/webhooks/resend', handleResendWebhook)
}
