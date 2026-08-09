import type { Context } from 'hono'

import {
  MAX_ORGANIZER_SESSION_TTL_MS,
  MAX_SUBMITTER_SESSION_TTL_MS,
  MAX_SUBMITTER_TOKEN_TTL_MS,
  type OrganizerActor,
  type SubmitterActor,
} from '../application'
import type { Session } from '../domain'

/** Committed TTL defaults; mirror `wrangler.jsonc` `vars`. */
export const DEFAULT_ORGANIZER_SESSION_TTL_MS = 2 * 60 * 60 * 1000
export const DEFAULT_SUBMITTER_SESSION_TTL_MS = 30 * 60 * 1000
export const DEFAULT_SUBMITTER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Worker bindings consumed by the API server. The D1 binding and the TTL keys
 * come from the generated `Env`; the local/admin/origin keys are supplied by
 * the environment (`.dev.vars` / deploy env) and intentionally stay out of
 * the generated binding type.
 */
export type ServerBindings = Pick<
  Env,
  'DB' | 'ORGANIZER_SESSION_TTL_MS' | 'SUBMITTER_SESSION_TTL_MS' | 'SUBMITTER_TOKEN_TTL_MS'
> & {
  readonly LOCAL_ADMIN_TOKEN?: string
  readonly LOCAL_DEV_MODE?: string
  readonly ALLOWED_ORIGINS?: string
}

/** Per-request context values set by the session/actor middleware. */
export interface ServerVariables {
  readonly session: Session
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

/** Explicit local/test mode flag. */
export function isLocalDevMode(context: ServerContext): boolean {
  return context.env.LOCAL_DEV_MODE === 'true'
}

/**
 * CSRF origin allowlist: environment-supplied `ALLOWED_ORIGINS` wins; when
 * unset, local/test mode falls back to the dev origins and everything else
 * fails closed (empty list -> all cookie-authenticated mutations rejected).
 */
export function getAllowedOrigins(context: ServerContext): readonly string[] {
  const raw = context.env.ALLOWED_ORIGINS
  if (raw !== undefined && raw.trim().length > 0) {
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
