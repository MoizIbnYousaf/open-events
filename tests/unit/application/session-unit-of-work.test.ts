import { describe, expect, it } from 'vitest'

import {
  SessionService,
  type RedeemSubmitterTokenResult,
  type RotateSessionResult,
  type SessionUnitOfWork,
  type StartInput,
} from '../../../src/application'
import type { CapturedMessage, Contact, Session, SubmitterToken } from '../../../src/domain'
import {
  EVENT_ID,
  EVENT_SLUG,
  FIXED_NOW,
  FORM_SLUG,
  VERSION_ID,
  createForm,
  createOrganizerSession,
  createSubmitterSession,
  createSubmitterToken,
  eventFixture,
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

class RecordingSessionUnitOfWork implements SessionUnitOfWork {
  readonly issueStartCalls: Array<{
    readonly contact: Contact
    readonly token: SubmitterToken
    readonly message: CapturedMessage
  }> = []
  readonly redeemCalls: Array<{ tokenId: string; consumedAt: string; session: Session }> = []
  readonly rotateCalls: Array<{ sessionId: string; consumedAt: string; rotated: Session }> = []
  redeemResult: RedeemSubmitterTokenResult = { outcome: 'redeemed' }
  rotateResult: RotateSessionResult = { outcome: 'rotated' }

  async issueStart(input: {
    readonly contact: Contact
    readonly token: SubmitterToken
    readonly message: CapturedMessage
  }): Promise<void> {
    this.issueStartCalls.push(input)
  }

  async redeemSubmitterToken(input: {
    readonly tokenId: string
    readonly consumedAt: string
    readonly session: Session
  }): Promise<RedeemSubmitterTokenResult> {
    this.redeemCalls.push(input)
    return this.redeemResult
  }

  async rotateSession(input: {
    readonly sessionId: string
    readonly consumedAt: string
    readonly rotated: Session
  }): Promise<RotateSessionResult> {
    this.rotateCalls.push(input)
    return this.rotateResult
  }
}

function buildHarness() {
  const tokens = new InMemoryTokenRepository()
  const sessions = new InMemorySessionRepository()
  const contacts = new InMemoryContactRepository([ownerContact])
  const events = new InMemoryEventRepository([eventFixture])
  const forms = new InMemoryFormRepository([
    createForm({ status: 'published', publishedVersionId: VERSION_ID }),
  ])
  const messages = new InMemoryCapturedMessageRepository()
  const unitOfWork = new RecordingSessionUnitOfWork()
  const hasher = {
    async hash(token: string): Promise<string> {
      return `hash:${token}`
    },
  }
  let nextToken = 0
  const tokenGenerator = {
    async generate(): Promise<string> {
      nextToken += 1
      return `token-${nextToken}`
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
    { now: () => FIXED_NOW },
  )
  return { service, unitOfWork, tokens, sessions, messages, contacts }
}

function startInput(): StartInput {
  return { email: 'speaker-a@example.test', eventSlug: EVENT_SLUG, formSlug: FORM_SLUG }
}

describe('SessionService atomic unit-of-work', () => {
  it('persists the start token, contact intent, and captured message in one port call', async () => {
    const { service, unitOfWork, tokens, messages } = buildHarness()

    const response = await service.startSubmitter(
      startInput(),
      60_000,
      (token, path) => `http://localhost${path}?token=${token}`,
    )

    expect(response).toEqual({ status: 'accepted' })
    expect(unitOfWork.issueStartCalls).toHaveLength(1)
    const call = unitOfWork.issueStartCalls[0]
    expect(call?.contact).toMatchObject({
      id: ownerContact.id,
      email: 'speaker-a@example.test',
      createdAt: FIXED_NOW,
    })
    expect(call?.token).toMatchObject({
      contactId: ownerContact.id,
      eventId: EVENT_ID,
      tokenHash: 'hash:token-1',
      createdAt: FIXED_NOW,
    })
    expect(call?.message.body).toContain('/cfp/demo-conf-2026/cfp?token=token-1')
    expect(tokens.list()).toEqual([])
    expect(messages.list()).toEqual([])
  })

  it('redeems the token atomically with a session bound to the contact', async () => {
    const { service, unitOfWork, tokens, sessions } = buildHarness()
    await tokens.save(createSubmitterToken())

    const issued = await service.redeemSubmitterToken('token-1', 60_000)

    expect(issued.contactId).toBe(ownerContact.id)
    expect(issued.eventId).toBe(EVENT_ID)
    expect(unitOfWork.redeemCalls).toHaveLength(1)
    const call = unitOfWork.redeemCalls[0]
    expect(call?.tokenId).toBe('token-id-1')
    expect(call?.consumedAt).toBe(FIXED_NOW)
    expect(call?.session).toMatchObject({
      kind: 'submitter',
      contactId: ownerContact.id,
      eventId: EVENT_ID,
    })
    expect(sessions.list()).toEqual([])
  })

  it('maps a redeem conflict to forbidden without issuing a session', async () => {
    const { service, unitOfWork, tokens } = buildHarness()
    unitOfWork.redeemResult = { outcome: 'conflict' }
    await tokens.save(createSubmitterToken())

    await expect(service.redeemSubmitterToken('token-1', 60_000)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(unitOfWork.redeemCalls).toHaveLength(1)
  })

  it('rotates a session atomically, preserving the identity subject', async () => {
    const { service, unitOfWork, sessions } = buildHarness()
    await sessions.save(createSubmitterSession())

    await service.rotateSession('sub-token', 60_000)

    expect(unitOfWork.rotateCalls).toHaveLength(1)
    const call = unitOfWork.rotateCalls[0]
    expect(call?.sessionId).toBe('session-sub-1')
    expect(call?.consumedAt).toBe(FIXED_NOW)
    expect(call?.rotated).toMatchObject({
      kind: 'submitter',
      contactId: ownerContact.id,
      eventId: EVENT_ID,
    })
    expect(sessions.list()).toHaveLength(1)
    expect(sessions.list()[0]?.tokenHash).toBe('hash:sub-token')
  })

  it('rotates an organizer session without a contact subject', async () => {
    const { service, unitOfWork, sessions } = buildHarness()
    await sessions.save(createOrganizerSession())

    await service.rotateSession('org-token', 60_000)

    const call = unitOfWork.rotateCalls[0]
    expect(call?.rotated.kind).toBe('organizer')
    expect(call?.rotated).not.toHaveProperty('contactId')
    expect(sessions.list()).toHaveLength(1)
  })

  it('maps a rotate conflict to forbidden', async () => {
    const { service, unitOfWork, sessions } = buildHarness()
    unitOfWork.rotateResult = { outcome: 'conflict' }
    await sessions.save(createOrganizerSession())

    await expect(service.rotateSession('org-token', 60_000)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(unitOfWork.rotateCalls).toHaveLength(1)
  })
})
