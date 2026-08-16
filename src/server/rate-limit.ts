import type { EdgeRateLimiter } from '../application/ports/rate-limiter'
import type { StartMailBudgetReservation } from '../application/ports/session-unit-of-work'
import type { D1Database } from '@cloudflare/workers-types'
import type { MiddlewareHandler } from 'hono'

import { ConfigError, type ServerContext } from './env'
import type { ServerEnv } from './env'
import { rateLimitedResponse } from './error'

export const EDGE_LIMIT_POLICIES = {
  startRecipient: {
    edgeLimit: 3,
    edgePeriodSeconds: 60,
    productLimit: 3,
    productWindowSeconds: 10 * 60,
  },
  startSource: {
    edgeLimit: 10,
    edgePeriodSeconds: 60,
    productLimit: 10,
    productWindowSeconds: 10 * 60,
  },
  adminLogin: {
    edgeLimit: 5,
    edgePeriodSeconds: 60,
    productLimit: 5,
    productWindowSeconds: 15 * 60,
  },
  redeemSource: {
    edgeLimit: 20,
    edgePeriodSeconds: 60,
    productLimit: 20,
    productWindowSeconds: 5 * 60,
  },
  redeemToken: {
    edgeLimit: 5,
    edgePeriodSeconds: 60,
    productLimit: 5,
    productWindowSeconds: 5 * 60,
  },
  organizerSend: {
    edgeLimit: 30,
    edgePeriodSeconds: 60,
    productLimit: 30,
    productWindowSeconds: 60 * 60,
  },
  resendWebhook: {
    edgeLimit: 120,
    edgePeriodSeconds: 60,
  },
} as const

export type EdgeLimitBindingName =
  | 'START_RECIPIENT_RATE_LIMITER'
  | 'START_SOURCE_RATE_LIMITER'
  | 'ADMIN_LOGIN_RATE_LIMITER'
  | 'TOKEN_REDEEM_SOURCE_RATE_LIMITER'
  | 'TOKEN_REDEEM_TOKEN_RATE_LIMITER'
  | 'ORGANIZER_SEND_RATE_LIMITER'
  | 'RESEND_WEBHOOK_RATE_LIMITER'

export type DurableLimitScope =
  | 'start_recipient_attempt'
  | 'start_source'
  | 'admin_login_failure'
  | 'redeem_source'
  | 'redeem_token'
  | 'organizer_send_event'

/** Trusted client address supplied by Cloudflare, never X-Forwarded-For. */
export function clientAddress(context: ServerContext): string | null {
  const address = normalizeClientAddress(context.req.header('CF-Connecting-IP') ?? '')
  return address === 'unknown' ? null : address
}

/** Canonical IPv4 or privacy-preserving IPv6 /64 source bucket. */
export function normalizeClientAddress(raw: string): string {
  const value = sanitizedAddress(raw)
  const ipv4 = normalizeIpv4(value)
  if (ipv4 !== null) return ipv4
  const ipv6 = expandIpv6(value)
  if (ipv6 === null) return 'unknown'
  return `${ipv6
    .slice(0, 4)
    .map((part) => Number.parseInt(part, 16).toString(16))
    .join(':')}::/64`
}

/** Validated raw address for Turnstile; never substitutes the limiter's IPv6 /64 bucket. */
export function turnstileRemoteAddress(raw: string): string | undefined {
  const value = sanitizedAddress(raw)
  const ipv4 = normalizeIpv4(value)
  if (ipv4 !== null) return ipv4
  return expandIpv6(value) === null ? undefined : value
}

function sanitizedAddress(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? ''
  )
}

function normalizeIpv4(value: string): string | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const number = Number(part)
    if (number < 0 || number > 255) return null
    octets.push(number)
  }
  return octets.join('.')
}

function expandIpv6(value: string): string[] | null {
  if (value.length === 0 || !value.includes(':') || value.includes(':::')) return null
  const doubleColon = value.indexOf('::')
  if (doubleColon !== -1 && doubleColon !== value.lastIndexOf('::')) return null
  const left = (doubleColon === -1 ? value : value.slice(0, doubleColon)).split(':').filter(Boolean)
  const right = (doubleColon === -1 ? '' : value.slice(doubleColon + 2)).split(':').filter(Boolean)
  const convert = (parts: string[]): string[] | null => {
    const expanded: string[] = []
    for (const part of parts) {
      const ipv4 = normalizeIpv4(part)
      if (ipv4 !== null) {
        const bytes = ipv4.split('.').map(Number)
        expanded.push(
          ((bytes[0] ?? 0) * 256 + (bytes[1] ?? 0)).toString(16),
          ((bytes[2] ?? 0) * 256 + (bytes[3] ?? 0)).toString(16),
        )
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null
        expanded.push(part.padStart(4, '0'))
      }
    }
    return expanded
  }
  const lhs = convert(left)
  const rhs = convert(right)
  if (lhs === null || rhs === null) return null
  if (doubleColon === -1) return lhs.length === 8 ? lhs : null
  const missing = 8 - lhs.length - rhs.length
  if (missing < 1) return null
  return [...lhs, ...Array<string>(missing).fill('0000'), ...rhs]
}

/** HMAC-bound key; neither logs nor bindings receive raw emails, IPs, or tokens. */
export async function keyedLimitKey(
  secret: string,
  purpose: string,
  value: string,
): Promise<string> {
  if (secret.length < 16) throw new ConfigError('Invalid rate-limit key configuration')
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}\u0000${value}`)),
  )
  return `v1:${purpose}:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function startMailBudgetReservation(
  context: ServerContext,
  normalizedEmail: string,
  now: string,
): Promise<StartMailBudgetReservation | null> {
  const secret = context.env.RATE_LIMIT_KEY_SECRET ?? ''
  const environment = context.env.RATE_LIMIT_ENVIRONMENT ?? ''
  if (secret.length < 16 || environment.length === 0) return null
  return {
    operationId: crypto.randomUUID(),
    recipientKey: await keyedLimitKey(secret, 'start-recipient', normalizedEmail),
    environmentKey: await keyedLimitKey(secret, 'mail-environment', environment),
    now,
  }
}

export async function durableLimitKey(
  context: ServerContext,
  purpose: string,
  value: string,
): Promise<string | null> {
  const secret = context.env.RATE_LIMIT_KEY_SECRET ?? ''
  if (secret.length < 16) return null
  return keyedLimitKey(secret, purpose, value)
}

/** Exact sliding-window counter in D1. Returns false without inserting at cap. */
export async function consumeDurableLimit(
  db: D1Database,
  input: {
    readonly scope: DurableLimitScope
    readonly keyHash: string
    readonly now: string
    readonly windowSeconds: number
    readonly limit: number
  },
): Promise<boolean> {
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return false
  const windowStart = new Date(nowMs - input.windowSeconds * 1000).toISOString()
  const result = await db
    .prepare(
      `INSERT INTO auth_limit_events (id, scope, key_hash, created_at)
       SELECT ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*) FROM auth_limit_events
         WHERE scope = ? AND key_hash = ? AND created_at > ? AND created_at <= ?
       ) < ?`,
    )
    .bind(
      crypto.randomUUID(),
      input.scope,
      input.keyHash,
      input.now,
      input.scope,
      input.keyHash,
      windowStart,
      input.now,
      input.limit,
    )
    .run()
  return result.meta.changes === 1
}

export async function durableLimitState(
  db: D1Database,
  input: {
    readonly scope: DurableLimitScope
    readonly keyHash: string
    readonly now: string
    readonly windowSeconds: number
    readonly limit: number
  },
): Promise<{ readonly blocked: boolean; readonly retryAfterSeconds: number }> {
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return { blocked: true, retryAfterSeconds: input.windowSeconds }
  const windowStart = new Date(nowMs - input.windowSeconds * 1000).toISOString()
  const rows = await db
    .prepare(
      `SELECT created_at FROM auth_limit_events
       WHERE scope = ? AND key_hash = ? AND created_at > ? AND created_at <= ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .bind(input.scope, input.keyHash, windowStart, input.now, input.limit)
    .all<{ created_at: string }>()
  if (rows.results.length < input.limit) return { blocked: false, retryAfterSeconds: 1 }
  const oldestMs = Date.parse(rows.results[0]?.created_at ?? input.now)
  return {
    blocked: true,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((oldestMs + input.windowSeconds * 1000 - nowMs) / 1000),
    ),
  }
}

export async function clearDurableLimit(
  db: D1Database,
  scope: DurableLimitScope,
  keyHash: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM auth_limit_events WHERE scope = ? AND key_hash = ?')
    .bind(scope, keyHash)
    .run()
}

/** Fail-closed adapter for the cheap Workers Rate Limiting binding. */
export async function consumeEdgeLimit(
  context: ServerContext,
  bindingName: EdgeLimitBindingName,
  key: string,
): Promise<boolean> {
  const binding = context.env[bindingName] as EdgeRateLimiter | undefined
  if (binding === undefined || typeof binding.limit !== 'function') return false
  try {
    return (await binding.limit({ key })).success
  } catch {
    return false
  }
}

export function boundedRetryAfter(seconds: number, maximum: number): string {
  return String(Math.max(1, Math.min(maximum, Math.ceil(seconds))))
}

/** Exact environment/event action window plus the cheap edge shield. */
export function organizerSendLimit(
  options: { readonly skipPreview?: boolean } = {},
): MiddlewareHandler<ServerEnv> {
  return async (context, next) => {
    if (options.skipPreview === true) {
      try {
        const body: unknown = await context.req.raw.clone().json()
        if (
          typeof body === 'object' &&
          body !== null &&
          !Array.isArray(body) &&
          (body as Record<string, unknown>).preview === true
        ) {
          await next()
          return
        }
      } catch {
        // Malformed bodies are charged and left to the handler's validation.
      }
    }
    const slug = context.req.param('slug') ?? 'unknown-event'
    const environment = context.env.RATE_LIMIT_ENVIRONMENT ?? ''
    const key =
      environment.length === 0
        ? null
        : await durableLimitKey(context, 'organizer-send-event', `${environment}:${slug}`)
    if (key === null) {
      return rateLimitedResponse(
        context,
        boundedRetryAfter(60, EDGE_LIMIT_POLICIES.organizerSend.productWindowSeconds),
      )
    }
    const edgeAllowed = await consumeEdgeLimit(context, 'ORGANIZER_SEND_RATE_LIMITER', key)
    if (!edgeAllowed) {
      return rateLimitedResponse(
        context,
        boundedRetryAfter(60, EDGE_LIMIT_POLICIES.organizerSend.productWindowSeconds),
      )
    }
    const now = new Date().toISOString()
    const allowed = await consumeDurableLimit(context.env.DB, {
      scope: 'organizer_send_event',
      keyHash: key,
      now,
      windowSeconds: EDGE_LIMIT_POLICIES.organizerSend.productWindowSeconds,
      limit: EDGE_LIMIT_POLICIES.organizerSend.productLimit,
    })
    if (!allowed) {
      const state = await durableLimitState(context.env.DB, {
        scope: 'organizer_send_event',
        keyHash: key,
        now,
        windowSeconds: EDGE_LIMIT_POLICIES.organizerSend.productWindowSeconds,
        limit: EDGE_LIMIT_POLICIES.organizerSend.productLimit,
      })
      return rateLimitedResponse(
        context,
        boundedRetryAfter(
          state.retryAfterSeconds,
          EDGE_LIMIT_POLICIES.organizerSend.productWindowSeconds,
        ),
      )
    }
    await next()
  }
}
