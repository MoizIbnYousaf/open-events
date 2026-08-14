import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { bindings, bindingsFrom } from './m2c-helpers'

/**
 * Hermeticity guard for the integration bindings helper.
 *
 * A local `.dev.vars` is loaded into the pool environment, and `.dev.vars`
 * is not part of the checkout, so any key left to the ambient environment would
 * silently change what the whole integration suite asserts depending on a file
 * some machines have and others do not. `ServerBindings` declares ten keys:
 * two resource bindings that can only come from the pool, and eight values a
 * `.dev.vars` can supply — the admin token, the local mode flag, the origin
 * allowlist, three TTLs, and the Clerk keys. These assertions pin the suite
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
      'ALLOWED_ORIGINS',
      'CLERK_PUBLISHABLE_KEY',
      'CLERK_SECRET_KEY',
      'DB',
      // Outbound email credentials. Present in the surface and pinned EMPTY by
      // the helper, so the suite exercises the capture-only fallback rather
      // than a special test path.
      'EMAIL_FROM',
      'FILES',
      'LOCAL_ADMIN_TOKEN',
      'LOCAL_DEV_MODE',
      'ORGANIZER_SESSION_TTL_MS',
      'RESEND_API_KEY',
      'SUBMITTER_SESSION_TTL_MS',
      'SUBMITTER_TOKEN_TTL_MS',
    ])
  })

  it('resolves the pool environment to those same suite values', () => {
    const resolved = bindings()

    expect(resolved.DB).toBe(env.DB)
    expect(resolved.FILES).toBe(env.FILES)
    expect(resolved.LOCAL_ADMIN_TOKEN).toBe('admin-secret')
    expect(resolved.LOCAL_DEV_MODE).toBe('false')
    expect(resolved.ALLOWED_ORIGINS).toBe('http://localhost:8787')
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
