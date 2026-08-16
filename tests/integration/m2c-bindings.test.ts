import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { bindings, bindingsFrom } from './m2c-helpers'

/**
 * Hermeticity guard for the integration bindings helper.
 *
 * A local `.dev.vars` is loaded into the pool environment, and `.dev.vars`
 * is not part of the checkout, so any key left to the ambient environment would
 * silently change what the whole integration suite asserts depending on a file
 * some machines have and others do not. `ServerBindings` declares the resource
 * bindings plus every value a `.dev.vars` can supply. These assertions pin the suite
 * values against an ambient environment where every one of them is wrong, and
 * keep `overrides` as the single opt-in for per-test values.
 */

/** Stand-in for the worst `.dev.vars` a developer could reasonably have. */
const AMBIENT = {
  DB: { marker: 'pool-database' },
  FILES: { marker: 'pool-bucket' },
  // Rejected by the server's TTL parser, so an inherited value cannot pass unnoticed.
  ORGANIZER_SESSION_TTL_MS: 'oops',
  SUBMITTER_SESSION_TTL_MS: '1',
  SUBMITTER_TOKEN_TTL_MS: '',
  LOCAL_ADMIN_TOKEN: 'a-developers-own-secret',
  LOCAL_DEV_MODE: 'true',
  PUBLIC_APP_URL: 'https://ambient-and-wrong.test',
  SUBMITTER_CAPABILITY_WRITER_MODE: 'legacy',
  SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'rollout',
  SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: 'not-a-timestamp',
  ALLOWED_ORIGINS: 'https://not-the-suite.test',
  UNRELATED_LOCAL_KEY: 'leaked',
}

/** Committed TTL defaults, the values `wrangler.jsonc` `vars` mirrors. */
const COMMITTED_TTLS = {
  ORGANIZER_SESSION_TTL_MS: '7200000',
  SUBMITTER_SESSION_TTL_MS: '28800000',
  SUBMITTER_TOKEN_TTL_MS: '86400000',
}

describe('integration bindings', () => {
  it('pins every environment-supplied server key regardless of ambient values', () => {
    const resolved = bindingsFrom(AMBIENT)

    expect(resolved.LOCAL_ADMIN_TOKEN).toBe('admin-secret')
    // The suite asserts production-shaped behaviour: local dev mode is OFF
    // unless a test opts in, whatever the ambient environment says.
    expect(resolved.LOCAL_DEV_MODE).toBe('false')
    expect(resolved.ALLOWED_ORIGINS).toBe('http://localhost:8787')
    expect(resolved.PUBLIC_APP_URL).toBe('https://www.openevents.engineer')
    expect(resolved.SUBMITTER_CAPABILITY_WRITER_MODE).toBe('purpose')
    expect(resolved.SUBMITTER_CAPABILITY_LEGACY_READER_MODE).toBe('bounded')
    expect(resolved.SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF).toBe('')
    expect(resolved.ORGANIZER_SESSION_TTL_MS).toBe(COMMITTED_TTLS.ORGANIZER_SESSION_TTL_MS)
    expect(resolved.SUBMITTER_SESSION_TTL_MS).toBe(COMMITTED_TTLS.SUBMITTER_SESSION_TTL_MS)
    expect(resolved.SUBMITTER_TOKEN_TTL_MS).toBe(COMMITTED_TTLS.SUBMITTER_TOKEN_TTL_MS)
  })

  it('forwards the resource bindings and nothing else from the ambient environment', () => {
    const resolved = bindingsFrom(AMBIENT)

    expect(resolved.DB).toBe(AMBIENT.DB)
    expect(resolved.FILES).toBe(AMBIENT.FILES)
    expect(Object.hasOwn(resolved, 'UNRELATED_LOCAL_KEY')).toBe(false)
    expect(Object.keys(resolved).sort()).toEqual([
      'ACCEPTANCE_RESET_SECRET',
      'ADMIN_LOGIN_RATE_LIMITER',
      'ALLOWED_ORIGINS',
      'ASSETS',
      'BUILD_REVISION',
      'CLERK_ORGANIZER_USER_IDS',
      'CLERK_PUBLISHABLE_KEY',
      'CLERK_SECRET_KEY',
      'DB',
      'DEPLOY_ENVIRONMENT',
      // Delivery mode/key are pinned capture-only. Provider credentials stay
      // empty, so no ambient secret can activate network delivery.
      'EMAIL_DELIVERY_MODE',
      'EMAIL_FROM',
      'EMAIL_LIVE_VERIFIED_AT',
      'EMAIL_PAYLOAD_KEY_V1',
      'EMAIL_PAYLOAD_KEY_VERSION',
      'FILES',
      'LOCAL_ADMIN_TOKEN',
      'LOCAL_DEV_MODE',
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL',
      'ORGANIZER_SEND_RATE_LIMITER',
      'ORGANIZER_SESSION_TTL_MS',
      'PUBLIC_APP_URL',
      'RATE_LIMIT_ENVIRONMENT',
      'RATE_LIMIT_KEY_SECRET',
      'RESEND_API_KEY',
      'RESEND_WEBHOOK_RATE_LIMITER',
      'RESEND_WEBHOOK_SECRET',
      'RESOURCE_D1_ID',
      'RESOURCE_R2_NAME',
      'START_RECIPIENT_RATE_LIMITER',
      'START_SOURCE_RATE_LIMITER',
      'SUBMITTER_CAPABILITY_LEGACY_READER_MODE',
      'SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF',
      'SUBMITTER_CAPABILITY_WRITER_MODE',
      'SUBMITTER_SESSION_TTL_MS',
      'SUBMITTER_TOKEN_TTL_MS',
      'TOKEN_REDEEM_SOURCE_RATE_LIMITER',
      'TOKEN_REDEEM_TOKEN_RATE_LIMITER',
      'TURNSTILE_HOSTNAMES',
      'TURNSTILE_SECRET_KEY',
    ])
  })

  it('resolves the pool environment to those same suite values', () => {
    const resolved = bindings()

    expect(resolved.DB).toBe(env.DB)
    expect(resolved.FILES).toBe(env.FILES)
    expect(resolved.LOCAL_ADMIN_TOKEN).toBe('admin-secret')
    expect(resolved.LOCAL_DEV_MODE).toBe('false')
    expect(resolved.ALLOWED_ORIGINS).toBe('http://localhost:8787')
    expect(resolved.PUBLIC_APP_URL).toBe('https://www.openevents.engineer')
    expect(resolved.SUBMITTER_CAPABILITY_WRITER_MODE).toBe('purpose')
    expect(resolved.SUBMITTER_CAPABILITY_LEGACY_READER_MODE).toBe('bounded')
    expect(resolved.SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF).toBe('')
    expect(resolved.ORGANIZER_SESSION_TTL_MS).toBe(COMMITTED_TTLS.ORGANIZER_SESSION_TTL_MS)
    expect(resolved.SUBMITTER_SESSION_TTL_MS).toBe(COMMITTED_TTLS.SUBMITTER_SESSION_TTL_MS)
    expect(resolved.SUBMITTER_TOKEN_TTL_MS).toBe(COMMITTED_TTLS.SUBMITTER_TOKEN_TTL_MS)
  })

  it('still lets a test opt in to other values through overrides', () => {
    expect(bindings({ LOCAL_DEV_MODE: 'true' }).LOCAL_DEV_MODE).toBe('true')
    expect(bindings({ ALLOWED_ORIGINS: '' }).ALLOWED_ORIGINS).toBe('')
    expect(bindings({ ALLOWED_ORIGINS: undefined }).ALLOWED_ORIGINS).toBeUndefined()
    expect(bindings({ LOCAL_ADMIN_TOKEN: 'other-secret' }).LOCAL_ADMIN_TOKEN).toBe('other-secret')
    expect(bindings({ ORGANIZER_SESSION_TTL_MS: 'oops' }).ORGANIZER_SESSION_TTL_MS).toBe('oops')
  })
})
