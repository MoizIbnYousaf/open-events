import { describe, expect, it } from 'vitest'

import {
  ConfigError,
  DEFAULT_ORGANIZER_SESSION_TTL_MS,
  DEFAULT_SUBMITTER_SESSION_TTL_MS,
  DEFAULT_SUBMITTER_TOKEN_TTL_MS,
  getAllowedOrigins,
  isLocalDevMode,
  localAdminToken,
  parseTtlMs,
  type ServerContext,
} from '../../../src/server/env'
import {
  MAX_ORGANIZER_SESSION_TTL_MS,
  MAX_SUBMITTER_SESSION_TTL_MS,
  MAX_SUBMITTER_TOKEN_TTL_MS,
} from '../../../src/application'

function context(env: Record<string, unknown>): ServerContext {
  return { env } as unknown as ServerContext
}

describe('parseTtlMs', () => {
  it('falls back to the committed default for absent or empty values', () => {
    expect(
      parseTtlMs(undefined, MAX_ORGANIZER_SESSION_TTL_MS, DEFAULT_ORGANIZER_SESSION_TTL_MS),
    ).toBe(DEFAULT_ORGANIZER_SESSION_TTL_MS)
    expect(parseTtlMs('', MAX_SUBMITTER_SESSION_TTL_MS, DEFAULT_SUBMITTER_SESSION_TTL_MS)).toBe(
      DEFAULT_SUBMITTER_SESSION_TTL_MS,
    )
  })

  it('accepts canonical positive digits within the bound', () => {
    expect(parseTtlMs('7200000', MAX_ORGANIZER_SESSION_TTL_MS, 1)).toBe(7200000)
    expect(parseTtlMs('1', MAX_SUBMITTER_TOKEN_TTL_MS, 1)).toBe(1)
  })

  it('rejects zero, negative, fractional, non-numeric, and over-max values', () => {
    for (const raw of [
      '0',
      '-1',
      '1.5',
      'not-a-number',
      '1e3',
      `${MAX_ORGANIZER_SESSION_TTL_MS + 1}`,
    ]) {
      expect(() => parseTtlMs(raw, MAX_ORGANIZER_SESSION_TTL_MS, 1)).toThrow(ConfigError)
    }
  })
})

describe('origin allowlist and env helpers', () => {
  it('uses ALLOWED_ORIGINS when set and fails closed otherwise', () => {
    expect(getAllowedOrigins(context({ ALLOWED_ORIGINS: 'http://a, http://b ' }))).toEqual([
      'http://a',
      'http://b',
    ])
    expect(getAllowedOrigins(context({}))).toEqual([])
    expect(getAllowedOrigins(context({ ALLOWED_ORIGINS: '' }))).toEqual([])
  })

  it('falls back to local dev origins in local/test mode', () => {
    expect(getAllowedOrigins(context({ LOCAL_DEV_MODE: 'true' }))).toEqual([
      'http://localhost:8787',
      'http://127.0.0.1:8787',
    ])
    expect(isLocalDevMode(context({ LOCAL_DEV_MODE: 'true' }))).toBe(true)
    expect(isLocalDevMode(context({}))).toBe(false)
  })

  it('separates an unset allowlist from an explicitly empty one in local dev mode', () => {
    const local = { LOCAL_DEV_MODE: 'true' }

    // Unset: the local dev fallback applies.
    expect(getAllowedOrigins(context({ ...local }))).toEqual([
      'http://localhost:8787',
      'http://127.0.0.1:8787',
    ])

    // Explicitly empty: fail closed, no fallback, every cross-origin mutation
    // rejected — an operator who blanks the value means "allow nothing".
    expect(getAllowedOrigins(context({ ...local, ALLOWED_ORIGINS: '' }))).toEqual([])
    expect(getAllowedOrigins(context({ ...local, ALLOWED_ORIGINS: '   ' }))).toEqual([])
    expect(getAllowedOrigins(context({ ...local, ALLOWED_ORIGINS: ' , ' }))).toEqual([])

    // Explicit list: exactly that list.
    expect(getAllowedOrigins(context({ ...local, ALLOWED_ORIGINS: 'http://a, http://b' }))).toEqual(
      ['http://a', 'http://b'],
    )
  })

  it('reads the local admin token with an empty default', () => {
    expect(localAdminToken(context({ LOCAL_ADMIN_TOKEN: 'x' }))).toBe('x')
    expect(localAdminToken(context({}))).toBe('')
  })
})

describe('committed TTL defaults', () => {
  it('match the frozen maxima', () => {
    expect(DEFAULT_ORGANIZER_SESSION_TTL_MS).toBe(2 * 60 * 60 * 1000)
    expect(DEFAULT_SUBMITTER_SESSION_TTL_MS).toBe(30 * 60 * 1000)
    expect(DEFAULT_SUBMITTER_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(DEFAULT_ORGANIZER_SESSION_TTL_MS).toBeLessThanOrEqual(MAX_ORGANIZER_SESSION_TTL_MS)
    expect(DEFAULT_SUBMITTER_SESSION_TTL_MS).toBeLessThanOrEqual(MAX_SUBMITTER_SESSION_TTL_MS)
    expect(DEFAULT_SUBMITTER_TOKEN_TTL_MS).toBeLessThanOrEqual(MAX_SUBMITTER_TOKEN_TTL_MS)
  })
})
