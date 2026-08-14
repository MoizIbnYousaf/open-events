import { describe, expect, it } from 'vitest'

import { SessionService } from '../../../src/application'
import { verifyClerkSessionToken } from '../../../src/server/clerk'
import { FIXED_NOW, VERSION_ID, createForm, eventFixture, ownerContact } from '../helpers/fixtures'
import {
  InMemoryCapturedMessageRepository,
  InMemoryContactRepository,
  InMemoryEventRepository,
  InMemoryFormRepository,
  InMemorySessionRepository,
  InMemoryTokenRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySessionUnitOfWork } from '../helpers/in-memory-unit-of-work'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

const FRONTEND_API = 'leading-heron-94.clerk.accounts.dev'
const PUBLISHABLE_KEY = `pk_test_${btoa(`${FRONTEND_API}$`)}`
const NOW_MS = Date.parse(FIXED_NOW)

describe('Clerk JWT to organizer session', () => {
  it('issues the same organizer session after a verified Clerk JWT', async () => {
    const keys = await generateRs256Pair()
    const token = await signJwt(
      keys.privateKey,
      { alg: 'RS256', kid: 'test-key' },
      {
        sub: 'user_live_path',
        iss: `https://${FRONTEND_API}`,
        exp: Math.floor(NOW_MS / 1000) + 120,
        azp: 'https://openevents.engineer',
      },
    )

    const identity = await verifyClerkSessionToken(token, {
      publishableKey: PUBLISHABLE_KEY,
      secretKey: '',
      authorizedParties: ['https://openevents.engineer'],
      nowMs: NOW_MS,
      fetchJwks: async () =>
        new Response(JSON.stringify({ keys: [keys.jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    expect(identity).toEqual({ userId: 'user_live_path' })

    const { service, sessions } = buildHarness()
    const issued = await service.issueOrganizerSession(60_000)

    expect(issued.expiresAt).toBe('2026-05-20T09:01:00.000Z')
    expect(sessions.list()).toHaveLength(1)
    const stored = sessions.list()[0]
    expect(stored?.kind).toBe('organizer')
    expect(stored).not.toHaveProperty('token')
    expect(stored?.tokenHash).not.toBe(issued.token)
    expect(JSON.stringify(issued)).not.toContain('user_live_path')
  })
})

function buildHarness() {
  const tokens = new InMemoryTokenRepository()
  const sessions = new InMemorySessionRepository()
  const contacts = new InMemoryContactRepository([ownerContact])
  const events = new InMemoryEventRepository([eventFixture])
  const forms = new InMemoryFormRepository([
    createForm({ status: 'published', publishedVersionId: VERSION_ID }),
  ])
  const messages = new InMemoryCapturedMessageRepository()
  const unitOfWork = new InMemorySessionUnitOfWork({ tokens, sessions, messages, contacts })
  let tokenCalls = 0
  const service = new SessionService(
    tokens,
    sessions,
    contacts,
    events,
    forms,
    { hash: async (value: string) => `hash:${value}` },
    {
      generate: async () => {
        tokenCalls += 1
        return `issued-${tokenCalls}`
      },
    },
    unitOfWork,
    { now: () => FIXED_NOW },
  )
  return { service, sessions }
}

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

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}
