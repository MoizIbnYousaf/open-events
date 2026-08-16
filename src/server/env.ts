import type { Context } from 'hono'

import {
  MAX_ORGANIZER_SESSION_TTL_MS,
  MAX_SUBMITTER_SESSION_TTL_MS,
  MAX_SUBMITTER_TOKEN_TTL_MS,
} from '../application/security/token-policy'
import type { OrganizerActor, SubmitterActor, ValidatedSession } from '../application/actors'
import type { EmailDeliveryConfig } from '../application/ports/email-delivery-repository'

/** Committed TTL defaults; mirror `wrangler.jsonc` `vars`. */
export const DEFAULT_ORGANIZER_SESSION_TTL_MS = 2 * 60 * 60 * 1000
/** Speaker magic-link sessions last a working day: a CFP draft, submit, and
 *  portal edit is routinely longer than half an hour. */
export const DEFAULT_SUBMITTER_SESSION_TTL_MS = 8 * 60 * 60 * 1000
export const DEFAULT_SUBMITTER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Worker bindings consumed by the API server. The D1 binding and the TTL keys
 * come from the generated `Env`; the local/admin/origin keys are supplied by
 * the environment (`.dev.vars` / deploy env) and intentionally stay out of
 * the generated binding type.
 */
export type ServerBindings = Pick<
  Env,
  | 'DB'
  | 'FILES'
  | 'ORGANIZER_SESSION_TTL_MS'
  | 'SUBMITTER_SESSION_TTL_MS'
  | 'SUBMITTER_TOKEN_TTL_MS'
  | 'START_RECIPIENT_RATE_LIMITER'
  | 'START_SOURCE_RATE_LIMITER'
  | 'ADMIN_LOGIN_RATE_LIMITER'
  | 'TOKEN_REDEEM_SOURCE_RATE_LIMITER'
  | 'TOKEN_REDEEM_TOKEN_RATE_LIMITER'
  | 'ORGANIZER_SEND_RATE_LIMITER'
  | 'RESEND_WEBHOOK_RATE_LIMITER'
  | 'RATE_LIMIT_ENVIRONMENT'
  | 'TURNSTILE_HOSTNAMES'
> & {
  /** Acceptance-only asset proxy so noindex applies to static responses. */
  readonly ASSETS?: Fetcher
  readonly LOCAL_ADMIN_TOKEN?: string
  readonly LOCAL_DEV_MODE?: string
  /** Runtime proof label: local, acceptance, or production. */
  readonly DEPLOY_ENVIRONMENT?: string
  /** Exact source revision supplied by the release workflow. */
  readonly BUILD_REVISION?: string
  /** Reviewed identifier matching the configured D1 binding. */
  readonly RESOURCE_D1_ID?: string
  /** Reviewed name matching the configured R2 binding. */
  readonly RESOURCE_R2_NAME?: string
  /** Separate release-operator credential; acceptance only. */
  readonly ACCEPTANCE_RESET_SECRET?: string
  readonly PUBLIC_APP_URL?: string
  /** Isolated acceptance origin used for the public guided tour. */
  readonly TOUR_APP_URL?: string
  readonly SUBMITTER_CAPABILITY_WRITER_MODE?: string
  readonly SUBMITTER_CAPABILITY_LEGACY_READER_MODE?: string
  readonly SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF?: string
  readonly ALLOWED_ORIGINS?: string
  /** Explicit delivery adapter snapshot for every newly-created job. */
  readonly EMAIL_DELIVERY_MODE?: string
  /** Active AES-GCM payload key version. */
  readonly EMAIL_PAYLOAD_KEY_VERSION?: string
  /** Base64-encoded 32-byte AES-GCM/HMAC key; secret binding only. */
  readonly EMAIL_PAYLOAD_KEY_V1?: string
  /** Canonical instant of the human live-sender verification gate. */
  readonly EMAIL_LIVE_VERIFIED_AT?: string
  /** Provider API key; required only in provider modes. */
  readonly RESEND_API_KEY?: string
  /** Standard Webhooks signing secret for the raw-body Resend callback. */
  readonly RESEND_WEBHOOK_SECRET?: string
  /** Verified sender identity; required only in provider modes. */
  readonly EMAIL_FROM?: string
  /** Clerk publishable key; public, used to locate the instance JWKS. */
  readonly CLERK_PUBLISHABLE_KEY?: string
  /** Clerk secret key; verifies session JWTs when the publishable key is absent. */
  readonly CLERK_SECRET_KEY?: string
  /** Explicit Clerk user ids allowed to exchange a verified identity. */
  readonly CLERK_ORGANIZER_USER_IDS?: string
  /** HMAC secret for privacy-preserving limiter keys; secret binding only. */
  readonly RATE_LIMIT_KEY_SECRET?: string
  /** Turnstile Siteverify secret; secret binding only. */
  readonly TURNSTILE_SECRET_KEY?: string
  /** OpenRouter key for Orby replies. Absent means Orby stays quiet. */
  readonly OPENROUTER_API_KEY?: string
  /** OpenRouter model id. Defaults to openai/gpt-5.6-luna. */
  readonly OPENROUTER_MODEL?: string
}

/** Per-request context values set by the session/actor middleware. */
export interface ServerVariables {
  readonly session: ValidatedSession
  readonly actor: OrganizerActor | SubmitterActor
}

export type ServerEnv = { Bindings: ServerBindings; Variables: ServerVariables }

/** Context type for handlers that resolve bindings from the Worker environment. */
export type ServerContext = Context<ServerEnv>

/** Configuration failure (invalid TTL, bad origin allowlist); maps to safe 500. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Parses a TTL value: canonical decimal digits only, positive, bounded by the
 * frozen per-kind maximum. Empty/absent values fall back to the committed
 * default; anything else is a `ConfigError` (safe 500, never echoed).
 */
export function parseTtlMs(raw: string | undefined, maxMs: number, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError('Invalid TTL configuration')
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maxMs) {
    throw new ConfigError('Invalid TTL configuration')
  }
  return value
}

/** Resolved TTL configuration for a request. */
export interface TtlConfig {
  readonly organizerSessionMs: number
  readonly submitterSessionMs: number
  readonly submitterTokenMs: number
}

export function getTtlConfig(context: ServerContext): TtlConfig {
  return {
    organizerSessionMs: parseTtlMs(
      context.env.ORGANIZER_SESSION_TTL_MS,
      MAX_ORGANIZER_SESSION_TTL_MS,
      DEFAULT_ORGANIZER_SESSION_TTL_MS,
    ),
    submitterSessionMs: parseTtlMs(
      context.env.SUBMITTER_SESSION_TTL_MS,
      MAX_SUBMITTER_SESSION_TTL_MS,
      DEFAULT_SUBMITTER_SESSION_TTL_MS,
    ),
    submitterTokenMs: parseTtlMs(
      context.env.SUBMITTER_TOKEN_TTL_MS,
      MAX_SUBMITTER_TOKEN_TTL_MS,
      DEFAULT_SUBMITTER_TOKEN_TTL_MS,
    ),
  }
}

/** Local admin credential from the environment; empty means login can never succeed. */
export function localAdminToken(context: ServerContext): string {
  return context.env.LOCAL_ADMIN_TOKEN ?? ''
}

/** Clerk publishable key from the Worker environment; empty means JWKS host is unknown. */
export function clerkPublishableKey(context: ServerContext): string {
  return context.env.CLERK_PUBLISHABLE_KEY ?? ''
}

/** Clerk secret key from the Worker environment; empty means Backend JWKS is unused. */
export function clerkSecretKey(context: ServerContext): string {
  return context.env.CLERK_SECRET_KEY ?? ''
}

/** Explicit Clerk organizer allowlist; an empty list keeps Clerk deny-by-default. */
export function clerkOrganizerUserIds(context: ServerContext): readonly string[] {
  return (context.env.CLERK_ORGANIZER_USER_IDS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function rateLimitKeySecret(context: ServerContext): string {
  return context.env.RATE_LIMIT_KEY_SECRET ?? ''
}

export function rateLimitEnvironment(context: ServerContext): string {
  return context.env.RATE_LIMIT_ENVIRONMENT ?? ''
}

export function turnstileSecretKey(context: ServerContext): string {
  return context.env.TURNSTILE_SECRET_KEY ?? ''
}

export function turnstileHostnames(context: ServerContext): readonly string[] {
  return (context.env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

/** Explicit local/test mode flag. */
export function isLocalDevMode(context: ServerContext): boolean {
  return context.env.LOCAL_DEV_MODE === 'true'
}

/**
 * Canonical externally visible origin used for every delivered/copied link.
 * Request headers are deliberately not an input.
 */
export function getPublicAppOrigin(context: ServerContext): string {
  const raw = context.env.PUBLIC_APP_URL
  if (raw === undefined || raw.trim().length === 0) {
    throw new ConfigError('Missing public application origin')
  }
  if (raw !== raw.trim()) throw new ConfigError('Invalid public application origin')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError('Invalid public application origin')
  }
  // URL normalisation must not erase a raw path (including encoded dot
  // segments) and accidentally turn it into a trusted origin.
  if (raw !== url.origin && raw !== `${url.origin}/`) {
    throw new ConfigError('Invalid public application origin')
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new ConfigError('Invalid public application origin')
  }
  if (url.protocol === 'https:') return url.origin
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (isLocalDevMode(context) && url.protocol === 'http:' && loopback) return url.origin
  throw new ConfigError('Invalid public application origin')
}

/**
 * Exact timestamp of the last Worker that could write null purpose/capability.
 * Missing, blank, or non-canonical values disable compatibility without
 * affecting purpose-bound rows.
 */
export function getLegacyWriterCutoff(context: ServerContext): string | null {
  const raw = context.env.SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF
  if (raw === undefined || raw === '') return null
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== raw) return null
  return raw
}

export type SubmitterCapabilityWriterMode = 'legacy' | 'purpose'
export type SubmitterCapabilityLegacyReaderMode = 'rollout' | 'bounded'

export interface SubmitterCapabilityRolloutConfig {
  readonly writerMode: SubmitterCapabilityWriterMode
  readonly legacyReaderMode: SubmitterCapabilityLegacyReaderMode
}

/**
 * Explicit two-release capability rollout switch. Missing or unknown modes are
 * configuration failures: a Worker must never guess whether it may emit a
 * purpose-bound credential while an older broad reader could still serve.
 */
export function getSubmitterCapabilityRolloutConfig(
  context: ServerContext,
): SubmitterCapabilityRolloutConfig {
  const writerMode = context.env.SUBMITTER_CAPABILITY_WRITER_MODE
  const legacyReaderMode = context.env.SUBMITTER_CAPABILITY_LEGACY_READER_MODE
  if (writerMode !== 'legacy' && writerMode !== 'purpose') {
    throw new ConfigError('Invalid submitter capability writer mode')
  }
  if (legacyReaderMode !== 'rollout' && legacyReaderMode !== 'bounded') {
    throw new ConfigError('Invalid submitter capability legacy reader mode')
  }
  if (writerMode === 'legacy' && legacyReaderMode !== 'rollout') {
    throw new ConfigError('Legacy capability writer requires rollout reader mode')
  }
  return { writerMode, legacyReaderMode }
}

export function emailDeliveryConfigFromBindings(env: ServerBindings): EmailDeliveryConfig {
  const mode = env.EMAIL_DELIVERY_MODE
  if (mode !== 'capture' && mode !== 'resend-test' && mode !== 'resend-live') {
    throw new ConfigError('Invalid email delivery mode')
  }
  const keyVersion = env.EMAIL_PAYLOAD_KEY_VERSION
  const keyMaterialBase64 = env.EMAIL_PAYLOAD_KEY_V1
  if (
    keyVersion !== 'v1' ||
    keyMaterialBase64 === undefined ||
    !/^[A-Za-z0-9+/]{43}=$/.test(keyMaterialBase64)
  ) {
    throw new ConfigError('Invalid email payload key configuration')
  }
  let keyBytes: string
  try {
    keyBytes = atob(keyMaterialBase64)
  } catch {
    throw new ConfigError('Invalid email payload key configuration')
  }
  if (keyBytes.length !== 32) throw new ConfigError('Invalid email payload key configuration')
  const environmentKey = env.RATE_LIMIT_ENVIRONMENT ?? ''
  if (environmentKey.trim() === '') throw new ConfigError('Invalid email delivery environment')
  if (mode === 'resend-live') {
    const hasHumanChallenge =
      (env.TURNSTILE_SECRET_KEY ?? '').trim() !== '' &&
      (env.TURNSTILE_HOSTNAMES ?? '').split(',').some((entry) => entry.trim().length > 0)
    const hasLimiterKey = (env.RATE_LIMIT_KEY_SECRET ?? '').trim() !== ''
    const hasLimiterBindings =
      env.START_RECIPIENT_RATE_LIMITER !== undefined &&
      env.START_SOURCE_RATE_LIMITER !== undefined &&
      env.ORGANIZER_SEND_RATE_LIMITER !== undefined &&
      env.RESEND_WEBHOOK_RATE_LIMITER !== undefined
    const hasSignedWebhook = (env.RESEND_WEBHOOK_SECRET ?? '').trim() !== ''
    if (!hasHumanChallenge || !hasLimiterKey || !hasLimiterBindings || !hasSignedWebhook) {
      throw new ConfigError('Incomplete live email safety configuration')
    }
  }
  return {
    mode,
    payloadKey: { keyVersion, keyMaterialBase64 },
    environmentKey,
    payloadRetentionMs: DEFAULT_SUBMITTER_TOKEN_TTL_MS,
  }
}

export function getEmailDeliveryConfig(context: ServerContext): EmailDeliveryConfig {
  return emailDeliveryConfigFromBindings(context.env)
}

/**
 * CSRF origin allowlist: any environment-supplied `ALLOWED_ORIGINS` wins,
 * including an explicitly empty one — blanking the value is a deliberate
 * "allow nothing" and fails closed (all cookie-authenticated mutations
 * rejected) even in local/test mode. Only a genuinely unset variable falls
 * back, to the dev origins in local/test mode and to the empty list otherwise.
 */
export function getAllowedOrigins(context: ServerContext): readonly string[] {
  const raw = context.env.ALLOWED_ORIGINS
  if (raw !== undefined) {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }
  if (isLocalDevMode(context)) {
    return ['http://localhost:8787', 'http://127.0.0.1:8787']
  }
  return []
}

/**
 * Resolves the D1 binding from the Worker environment.
 *
 * The generated `Env` type marks the binding as required, but a Worker deployed
 * without the binding has `undefined` at runtime, so callers treat the result
 * as optional.
 */
export function getDatabaseBinding(context: ServerContext): D1Database | null {
  return context.env.DB ?? null
}

/** Safe 503 response used when the required D1 binding is missing. */
export function databaseUnavailableResponse(context: ServerContext): Response {
  return context.json({ error: { code: 'internal', message: 'database_unavailable' } }, 503)
}

/**
 * Resolves the R2 uploads binding. As with D1, a Worker deployed without the
 * binding has `undefined` at runtime, so callers treat it as optional.
 */
export function getFilesBinding(context: ServerContext): R2Bucket | null {
  return context.env.FILES ?? null
}

/** Safe 503 response used when the required R2 binding is missing. */
export function storageUnavailableResponse(context: ServerContext): Response {
  return context.json({ error: { code: 'internal', message: 'storage_unavailable' } }, 503)
}
