import { describe, expect, it } from 'vitest'

import { frontendApiFromPublishableKey, verifyClerkSessionToken } from '../../../src/server/clerk'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

const FRONTEND_API = 'leading-heron-94.clerk.accounts.dev'
const PUBLISHABLE_KEY = `pk_test_${btoa(`${FRONTEND_API}$`)}`
const NOW_MS = Date.parse('2026-08-14T12:00:00.000Z')

describe('frontendApiFromPublishableKey', () => {
  it('decodes the Clerk frontend API host', () => {
    expect(frontendApiFromPublishableKey(PUBLISHABLE_KEY)).toBe(FRONTEND_API)
    expect(frontendApiFromPublishableKey('not-a-key')).toBeNull()
  })
})

describe('verifyClerkSessionToken', () => {
  it('accepts a signed session JWT and rejects the rest', async () => {
    const keys = await generateRs256Pair()
    const token = await signJwt(
      keys.privateKey,
      {
        alg: 'RS256',
        kid: 'test-key',
        typ: 'JWT',
      },
      {
        sub: 'user_abc',
        iss: `https://${FRONTEND_API}`,
        exp: Math.floor(NOW_MS / 1000) + 60,
        azp: 'https://openevents.engineer',
      },
    )
    const fetchJwks = makeJwksFetch(keys.jwk)

    const identity = await verifyClerkSessionToken(token, {
      publishableKey: PUBLISHABLE_KEY,
      secretKey: '',
      authorizedParties: ['https://openevents.engineer'],
      nowMs: NOW_MS,
      fetchJwks,
    })
    expect(identity).toEqual({ userId: 'user_abc' })

    const expired = await signJwt(
      keys.privateKey,
      {
        alg: 'RS256',
        kid: 'test-key',
      },
      {
        sub: 'user_abc',
        iss: `https://${FRONTEND_API}`,
        exp: Math.floor(NOW_MS / 1000) - 10,
      },
    )
    expect(
      await verifyClerkSessionToken(expired, {
        publishableKey: PUBLISHABLE_KEY,
        secretKey: '',
        authorizedParties: [],
        nowMs: NOW_MS,
        fetchJwks,
      }),
    ).toBeNull()

    expect(
      await verifyClerkSessionToken('not-a-jwt', {
        publishableKey: PUBLISHABLE_KEY,
        secretKey: '',
        authorizedParties: [],
        nowMs: NOW_MS,
        fetchJwks,
      }),
    ).toBeNull()
  })

  it('rejects a pending organization status and a foreign authorized party', async () => {
    const keys = await generateRs256Pair()
    const fetchJwks = makeJwksFetch(keys.jwk)
    const pending = await signJwt(
      keys.privateKey,
      {
        alg: 'RS256',
        kid: 'test-key',
      },
      {
        sub: 'user_abc',
        iss: `https://${FRONTEND_API}`,
        exp: Math.floor(NOW_MS / 1000) + 60,
        sts: 'pending',
      },
    )
    expect(
      await verifyClerkSessionToken(pending, {
        publishableKey: PUBLISHABLE_KEY,
        secretKey: '',
        authorizedParties: [],
        nowMs: NOW_MS,
        fetchJwks,
      }),
    ).toBeNull()

    const foreign = await signJwt(
      keys.privateKey,
      {
        alg: 'RS256',
        kid: 'test-key',
      },
      {
        sub: 'user_abc',
        iss: `https://${FRONTEND_API}`,
        exp: Math.floor(NOW_MS / 1000) + 60,
        azp: 'https://evil.example',
      },
    )
    expect(
      await verifyClerkSessionToken(foreign, {
        publishableKey: PUBLISHABLE_KEY,
        secretKey: '',
        authorizedParties: ['https://openevents.engineer'],
        nowMs: NOW_MS,
        fetchJwks,
      }),
    ).toBeNull()
  })
})

async function generateRs256Pair(): Promise<{
  readonly privateKey: CryptoKey
  readonly jwk: JsonWebKey & { kid: string }
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey & {
    kid: string
  }
  jwk.kid = 'test-key'
  jwk.alg = 'RS256'
  jwk.use = 'sig'
  return { privateKey: pair.privateKey, jwk }
}

async function signJwt(
  privateKey: CryptoKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const encodedHeader = base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(header)))
  const encodedPayload = base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(payload)))
  const signed = `${encodedHeader}.${encodedPayload}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signed),
  )
  return `${signed}.${base64UrlFromBytes(new Uint8Array(signature))}`
}

function makeJwksFetch(jwk: JsonWebKey): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}
