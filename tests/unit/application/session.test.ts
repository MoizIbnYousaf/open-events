import { describe, expect, it } from 'vitest'

import {
  SessionService,
  createSha256TokenHasher,
  createUuidTokenGenerator,
  isSessionValid,
  isTokenRedeemable,
  type StartInput,
} from '../../../src/application'
import type { Session, SubmitterToken } from '../../../src/domain'
import {
  EVENT_ID,
  EVENT_SLUG,
  FIXED_NOW,
  FORM_SLUG,
  NOW,
  VERSION_ID,
  createForm,
  createSubmitterSession,
  createSubmitterToken,
  eventFixture,
  ownerActor,
  ownerContact,
} from '../helpers/fixtures'
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

function buildHarness(clockNow: string = FIXED_NOW) {
  const tokens = new InMemoryTokenRepository()
  const sessions = new InMemorySessionRepository()
  const contacts = new InMemoryContactRepository([ownerContact])
  const events = new InMemoryEventRepository([eventFixture])
  const forms = new InMemoryFormRepository([
    createForm({ status: 'published', publishedVersionId: VERSION_ID }),
  ])
  const messages = new InMemoryCapturedMessageRepository()
  const unitOfWork = new InMemorySessionUnitOfWork({ tokens, sessions, messages, contacts })
  const hasher = {
    async hash(token: string): Promise<string> {
      return `hash:${token}`
    },
  }
  let tokenCalls = 0
  const tokenGenerator = {
    async generate(): Promise<string> {
      tokenCalls += 1
      return `token-${tokenCalls}`
    },
  }
  const service = new SessionService(
    tokens,
    sessions,
    contacts,
    events,
    forms,
    hasher,
    tokenGenerator,
    unitOfWork,
    { now: () => clockNow },
  )
  return { service, tokens, sessions, contacts, messages, tokenCalls }
}

function startInput(overrides: Partial<StartInput> = {}): StartInput {
  return {
    email: 'speaker-a@example.test',
    eventSlug: EVENT_SLUG,
    formSlug: FORM_SLUG,
    ...overrides,
  }
}

function linkBuilder(token: string, path: string): string {
  return `http://localhost${path}?token=${token}`
}

describe('token policy', () => {
  const valid: SubmitterToken = createSubmitterToken()

  it('redeems only unexpired, unconsumed tokens', () => {
    expect(isTokenRedeemable(valid, NOW)).toBe(true)
    expect(isTokenRedeemable({ ...valid, expiresAt: NOW }, NOW)).toBe(false)
    expect(isTokenRedeemable({ ...valid, consumedAt: NOW }, NOW)).toBe(false)
  })

  it('validates sessions the same way', () => {
    const session: Session = createSubmitterSession()
    expect(isSessionValid(session, NOW)).toBe(true)
    expect(isSessionValid({ ...session, expiresAt: NOW }, NOW)).toBe(false)
    expect(isSessionValid({ ...session, consumedAt: NOW }, NOW)).toBe(false)
  })
})

describe('SessionService.organizerLogin', () => {
  it('issues an organizer session for the correct secret with clock-derived expiry', async () => {
    const { service, sessions } = buildHarness()

    const issued = await service.organizerLogin('secret', 'secret', 60_000)

    expect(issued.token).toBe('token-1')
    expect(issued.expiresAt).toBe('2026-05-20T09:01:00.000Z')
    const session = sessions.list()[0]
    expect(session?.kind).toBe('organizer')
    expect(session).not.toHaveProperty('contactId')
  })

  it('rejects a wrong secret with the exact unauthorized error and leaks no token', async () => {
    const { service, sessions, tokenCalls } = buildHarness()

    const error = await service
      .organizerLogin('wrong', 'secret', 60_000)
      .catch((candidate: unknown) => candidate)

    expect(error).toMatchObject({ code: 'unauthorized', message: 'Invalid organizer secret' })
    expect(sessions.list()).toEqual([])
    expect(tokenCalls).toBe(0)
    expect(JSON.stringify(error)).not.toContain('token')
  })

  it('issues an organizer session for equal secrets including non-ASCII', async () => {
    const { service, sessions } = buildHarness()

    const issued = await service.organizerLogin('sécret-🔑', 'sécret-🔑', 60_000)

    expect(issued.token).toBeTruthy()
    expect(issued.expiresAt).toBe('2026-05-20T09:01:00.000Z')
    expect(sessions.list()).toHaveLength(1)
  })
})

describe('SessionService.startSubmitter', () => {
  it('normalizes and dedupes the contact, persists the token with event context, and captures the link', async () => {
    const { service, tokens, contacts, messages } = buildHarness()

    const response = await service.startSubmitter(
      startInput({ email: '  Speaker-A@Example.TEST ' }),
      60_000,
      linkBuilder,
    )

    expect(response).toEqual({ status: 'accepted' })
    expect(contacts.list()).toHaveLength(1)
    expect(await contacts.findByEmail('speaker-a@example.test')).not.toBeNull()
    const token = tokens.list()[0]
    expect(token?.tokenHash).toBe('hash:token-1')
    expect(token?.contactId).toBe(ownerContact.id)
    expect(token?.eventId).toBe(EVENT_ID)
    expect(token?.createdAt).toBe(FIXED_NOW)
    const message = messages.list()[0]
    expect(message?.toEmail).toBe('speaker-a@example.test')
    expect(message?.body).toContain('/cfp/demo-conf-2026/cfp?token=token-1')
  })

  it('rejects unknown events and unpublished forms', async () => {
    const { service } = buildHarness()

    await expect(
      service.startSubmitter(startInput({ eventSlug: 'unknown-event' }), 60_000, linkBuilder),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      service.startSubmitter(startInput({ formSlug: 'unknown-form' }), 60_000, linkBuilder),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects an invalid email and invalid TTLs', async () => {
    const { service } = buildHarness()

    await expect(
      service.startSubmitter(startInput({ email: 'not-an-email' }), 60_000, linkBuilder),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    await expect(service.startSubmitter(startInput(), 0, linkBuilder)).rejects.toBeInstanceOf(
      RangeError,
    )
  })
})

describe('SessionService.redeemSubmitterToken', () => {
  it('redeems a token once and issues a session bound to the contact and event', async () => {
    const { service, tokens, sessions } = buildHarness()
    await tokens.save(createSubmitterToken())

    const issued = await service.redeemSubmitterToken('token-1', 60_000)

    expect(issued.contactId).toBe(ownerContact.id)
    expect(issued.eventId).toBe(EVENT_ID)
    expect(issued.token).toBe('token-1')
    expect(issued.expiresAt).toBe('2026-05-20T09:01:00.000Z')
    expect(tokens.list()[0]?.consumedAt).toBe(FIXED_NOW)
    expect(sessions.list()[0]).toMatchObject({
      kind: 'submitter',
      contactId: ownerContact.id,
      eventId: EVENT_ID,
    })
  })

  it('rejects a second redemption', async () => {
    const { service, tokens } = buildHarness()
    await tokens.save(createSubmitterToken())
    await service.redeemSubmitterToken('token-1', 60_000)

    await expect(service.redeemSubmitterToken('token-1', 60_000)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('rejects an expired token', async () => {
    const { service, tokens } = buildHarness()
    await tokens.save(createSubmitterToken({ expiresAt: FIXED_NOW }))

    await expect(service.redeemSubmitterToken('token-1', 60_000)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })
})

describe('SessionService.validateSession and rotateSession', () => {
  it('validates a live session and rejects expired or consumed ones', async () => {
    const { service, sessions } = buildHarness()
    await sessions.save(createSubmitterSession())

    expect(await service.validateSession('sub-token')).toMatchObject({
      kind: 'submitter',
      contactId: ownerContact.id,
      eventId: EVENT_ID,
    })
    await sessions.save(
      createSubmitterSession({
        id: 'session-expired',
        tokenHash: 'hash:expired',
        expiresAt: FIXED_NOW,
      }),
    )
    expect(await service.validateSession('expired')).toBeNull()
    await sessions.save(
      createSubmitterSession({
        id: 'session-consumed',
        tokenHash: 'hash:consumed',
        consumedAt: FIXED_NOW,
      }),
    )
    expect(await service.validateSession('consumed')).toBeNull()
    expect(await service.validateSession('sub-token-unknown')).toBeNull()
  })

  it('rotates a submitter session preserving contact and event', async () => {
    const { service, sessions } = buildHarness()
    await sessions.save(createSubmitterSession())

    const rotated = await service.rotateSession('sub-token', 60_000)

    expect(rotated.kind).toBe('submitter')
    const stored = sessions.list()
    expect(stored.find((session) => session.id === 'session-sub-1')?.consumedAt).toBe(FIXED_NOW)
    const next = stored.find((session) => session.tokenHash === 'hash:token-1')
    expect(next).toMatchObject({ kind: 'submitter', contactId: ownerContact.id, eventId: EVENT_ID })
  })

  it('rotates an organizer session without a contact subject', async () => {
    const { service, sessions } = buildHarness()
    await service.organizerLogin('secret', 'secret', 60_000)

    const rotated = await service.rotateSession('token-1', 60_000)

    expect(rotated.kind).toBe('organizer')
    const next = sessions.list().find((session) => session.tokenHash === 'hash:token-2')
    expect(next?.kind).toBe('organizer')
    expect(next).not.toHaveProperty('contactId')
  })

  it('rejects rotation of an invalid session', async () => {
    const { service } = buildHarness()

    await expect(service.rotateSession('token-unknown', 60_000)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('derives every instant from the service clock', async () => {
    const later = buildHarness('2026-05-21T00:00:00.000Z')

    const issued = await later.service.organizerLogin('secret', 'secret', 60_000)

    expect(issued.expiresAt).toBe('2026-05-21T00:01:00.000Z')
  })
})

describe('webcrypto token seams', () => {
  it('hashes deterministically with SHA-256', async () => {
    const hasher = createSha256TokenHasher()
    const first = await hasher.hash('raw-token')
    const second = await hasher.hash('raw-token')

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(second)
    expect(first).not.toBe(await hasher.hash('raw-token-2'))
  })

  it('generates UUID-shaped tokens', async () => {
    const generator = createUuidTokenGenerator()
    const token = await generator.generate()

    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('actor derivation from sessions', () => {
  it('derives the submitter actor from a validated session', async () => {
    const { service, sessions } = buildHarness()
    await sessions.save(createSubmitterSession())

    const session = await service.validateSession('sub-token')
    expect(session?.kind).toBe('submitter')
    if (session?.kind === 'submitter') {
      expect(session.contactId).toBe(ownerActor.contactId)
      expect(session.eventId).toBe(ownerActor.eventId)
    }
  })
})
