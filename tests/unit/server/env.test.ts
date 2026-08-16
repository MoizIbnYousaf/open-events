import { describe, expect, it } from 'vitest'

import {
  ConfigError,
  DEFAULT_ORGANIZER_SESSION_TTL_MS,
  DEFAULT_SUBMITTER_SESSION_TTL_MS,
  DEFAULT_SUBMITTER_TOKEN_TTL_MS,
  getAllowedOrigins,
  getLegacyWriterCutoff,
  getEmailDeliveryConfig,
  getPublicAppOrigin,
  getSubmitterCapabilityRolloutConfig,
  isLocalDevMode,
  clerkPublishableKey,
  clerkSecretKey,
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
  const emailKey = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='

  it('requires an explicit canonical encryption key and environment for captured mail', () => {
    expect(
      getEmailDeliveryConfig(
        context({
          EMAIL_DELIVERY_MODE: 'capture',
          EMAIL_PAYLOAD_KEY_VERSION: 'v1',
          EMAIL_PAYLOAD_KEY_V1: emailKey,
          RATE_LIMIT_ENVIRONMENT: 'test',
        }),
      ),
    ).toMatchObject({ mode: 'capture', environmentKey: 'test' })

    for (const values of [
      {},
      { EMAIL_DELIVERY_MODE: 'capture' },
      {
        EMAIL_DELIVERY_MODE: 'capture',
        EMAIL_PAYLOAD_KEY_VERSION: 'v1',
        EMAIL_PAYLOAD_KEY_V1: ` ${emailKey}`,
        RATE_LIMIT_ENVIRONMENT: 'test',
      },
      {
        EMAIL_DELIVERY_MODE: 'capture',
        EMAIL_PAYLOAD_KEY_VERSION: 'v2',
        EMAIL_PAYLOAD_KEY_V1: emailKey,
        RATE_LIMIT_ENVIRONMENT: 'test',
      },
      {
        EMAIL_DELIVERY_MODE: 'capture',
        EMAIL_PAYLOAD_KEY_VERSION: 'v1',
        EMAIL_PAYLOAD_KEY_V1: emailKey,
        RATE_LIMIT_ENVIRONMENT: '',
      },
    ]) {
      expect(() => getEmailDeliveryConfig(context(values))).toThrow(ConfigError)
    }
  })

  it('fails live delivery closed until human verification and limiter controls exist', () => {
    const live = {
      EMAIL_DELIVERY_MODE: 'resend-live',
      EMAIL_PAYLOAD_KEY_VERSION: 'v1',
      EMAIL_PAYLOAD_KEY_V1: emailKey,
      RATE_LIMIT_ENVIRONMENT: 'production',
      RATE_LIMIT_KEY_SECRET: 'rate-secret',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      TURNSTILE_HOSTNAMES: 'www.openevents.engineer',
      START_RECIPIENT_RATE_LIMITER: {},
      START_SOURCE_RATE_LIMITER: {},
      ORGANIZER_SEND_RATE_LIMITER: {},
      RESEND_WEBHOOK_RATE_LIMITER: {},
      RESEND_WEBHOOK_SECRET: 'whsec_test',
    }
    expect(getEmailDeliveryConfig(context(live))).toMatchObject({
      mode: 'resend-live',
      environmentKey: 'production',
    })
    for (const key of [
      'RATE_LIMIT_KEY_SECRET',
      'TURNSTILE_SECRET_KEY',
      'TURNSTILE_HOSTNAMES',
      'START_RECIPIENT_RATE_LIMITER',
      'START_SOURCE_RATE_LIMITER',
      'ORGANIZER_SEND_RATE_LIMITER',
      'RESEND_WEBHOOK_RATE_LIMITER',
      'RESEND_WEBHOOK_SECRET',
    ]) {
      expect(() => getEmailDeliveryConfig(context({ ...live, [key]: undefined }))).toThrow(
        ConfigError,
      )
    }
  })

  it('accepts only a canonical HTTPS application origin outside local mode', () => {
    expect(getPublicAppOrigin(context({ PUBLIC_APP_URL: 'https://www.openevents.engineer' }))).toBe(
      'https://www.openevents.engineer',
    )
    expect(
      getPublicAppOrigin(context({ PUBLIC_APP_URL: 'https://www.openevents.engineer/' })),
    ).toBe('https://www.openevents.engineer')

    for (const publicAppUrl of [
      undefined,
      '',
      'not a url',
      ' https://openevents.engineer',
      'https://openevents.engineer ',
      'http://openevents.engineer',
      'https://user:pass@openevents.engineer',
      'https://openevents.engineer/path',
      'https://openevents.engineer/%2e',
      'https://openevents.engineer/%2e%2e',
      'https://openevents.engineer/a/../',
      'https://openevents.engineer//',
      'https://openevents.engineer?from=host',
      'https://openevents.engineer/#fragment',
    ]) {
      expect(() =>
        getPublicAppOrigin(
          context(publicAppUrl === undefined ? {} : { PUBLIC_APP_URL: publicAppUrl }),
        ),
      ).toThrow(ConfigError)
    }
  })

  it('permits HTTP only for explicit loopback origins in local mode', () => {
    for (const publicAppUrl of [
      'http://localhost:5173',
      'http://127.0.0.1:8787',
      'http://[::1]:5173',
    ]) {
      expect(
        getPublicAppOrigin(context({ LOCAL_DEV_MODE: 'true', PUBLIC_APP_URL: publicAppUrl })),
      ).toBe(publicAppUrl)
    }
    for (const publicAppUrl of [
      'http://example.test:5173',
      'http://0.0.0.0:5173',
      'http://localhost.example.test:5173',
    ]) {
      expect(() =>
        getPublicAppOrigin(context({ LOCAL_DEV_MODE: 'true', PUBLIC_APP_URL: publicAppUrl })),
      ).toThrow(ConfigError)
    }
  })

  it('parses the exact legacy-writer cutoff and fails closed when absent or malformed', () => {
    expect(
      getLegacyWriterCutoff(
        context({ SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: '2026-08-15T12:34:56.000Z' }),
      ),
    ).toBe('2026-08-15T12:34:56.000Z')
    expect(getLegacyWriterCutoff(context({}))).toBeNull()
    expect(
      getLegacyWriterCutoff(context({ SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: '' })),
    ).toBeNull()
    expect(
      getLegacyWriterCutoff(
        context({ SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: '2026-08-15T12:34:56Z' }),
      ),
    ).toBeNull()
  })

  it('requires explicit safe capability rollout modes and rejects unsafe combinations', () => {
    expect(
      getSubmitterCapabilityRolloutConfig(
        context({
          SUBMITTER_CAPABILITY_WRITER_MODE: 'legacy',
          SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'rollout',
        }),
      ),
    ).toEqual({ writerMode: 'legacy', legacyReaderMode: 'rollout' })
    expect(
      getSubmitterCapabilityRolloutConfig(
        context({
          SUBMITTER_CAPABILITY_WRITER_MODE: 'purpose',
          SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'bounded',
        }),
      ),
    ).toEqual({ writerMode: 'purpose', legacyReaderMode: 'bounded' })
    for (const values of [
      {},
      { SUBMITTER_CAPABILITY_WRITER_MODE: 'unknown' },
      {
        SUBMITTER_CAPABILITY_WRITER_MODE: 'legacy',
        SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'bounded',
      },
      {
        SUBMITTER_CAPABILITY_WRITER_MODE: 'purpose',
        SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'unknown',
      },
    ]) {
      expect(() => getSubmitterCapabilityRolloutConfig(context(values))).toThrow(ConfigError)
    }
  })

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

  it('reads Clerk keys with empty defaults', () => {
    expect(clerkPublishableKey(context({ CLERK_PUBLISHABLE_KEY: 'pk_test_x' }))).toBe('pk_test_x')
    expect(clerkPublishableKey(context({}))).toBe('')
    expect(clerkSecretKey(context({ CLERK_SECRET_KEY: 'sk_test_x' }))).toBe('sk_test_x')
    expect(clerkSecretKey(context({}))).toBe('')
  })
})

describe('committed TTL defaults', () => {
  it('match the frozen maxima', () => {
    expect(DEFAULT_ORGANIZER_SESSION_TTL_MS).toBe(2 * 60 * 60 * 1000)
    expect(DEFAULT_SUBMITTER_SESSION_TTL_MS).toBe(8 * 60 * 60 * 1000)
    expect(DEFAULT_SUBMITTER_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(DEFAULT_ORGANIZER_SESSION_TTL_MS).toBeLessThanOrEqual(MAX_ORGANIZER_SESSION_TTL_MS)
    expect(DEFAULT_SUBMITTER_SESSION_TTL_MS).toBeLessThanOrEqual(MAX_SUBMITTER_SESSION_TTL_MS)
    expect(DEFAULT_SUBMITTER_TOKEN_TTL_MS).toBeLessThanOrEqual(MAX_SUBMITTER_TOKEN_TTL_MS)
  })
})
