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
  organizerActor,
  ownerContact,
  startMailBudgetFixture,
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
    readonly budget: import('../../../src/application').StartMailBudgetReservation
  }> = []
  readonly issueRoleAccessCalls: Array<Parameters<SessionUnitOfWork['issueRoleAccess']>[0]> = []
  readonly redeemCalls: Array<{ tokenId: string; consumedAt: string; session: Session }> = []
  readonly rotateCalls: Array<{ sessionId: string; consumedAt: string; rotated: Session }> = []
  redeemResult: RedeemSubmitterTokenResult = { outcome: 'redeemed' }
  rotateResult: RotateSessionResult = { outcome: 'rotated' }

  async issueRoleAccess(
    input: Parameters<SessionUnitOfWork['issueRoleAccess']>[0],
  ): Promise<{ readonly outcome: 'issued' }> {
    this.issueRoleAccessCalls.push(input)
    return { outcome: 'issued' }
  }

  async issueStart(input: {
    readonly contact: Contact
    readonly token: SubmitterToken
    readonly message: CapturedMessage
    readonly budget: import('../../../src/application').StartMailBudgetReservation
  }): Promise<import('../../../src/application').IssueStartResult> {
    this.issueStartCalls.push(input)
    return { outcome: 'issued' }
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

function buildHarness(
  lastLegacyWriterCutoff: string | null = null,
  capabilityRollout: import('../../../src/application/services/session').SubmitterCapabilityRollout = {
    writerMode: 'purpose',
    legacyReaderMode: 'bounded',
  },
) {
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
    lastLegacyWriterCutoff,
    { publicAppOrigin: 'https://www.openevents.engineer', ttlMs: 60_000 },
    capabilityRollout,
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
      'https://www.openevents.engineer',
      startMailBudgetFixture(),
    )

    expect(response.outcome).toBe('issued')
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
      purpose: 'cfp',
      tokenHash: 'hash:token-1',
      createdAt: FIXED_NOW,
    })
    expect(call?.message.body).toContain(
      'https://www.openevents.engineer/api/public/session?token=token-1',
    )
    expect(response).toMatchObject({
      outcome: 'issued',
      accessUrl: 'https://www.openevents.engineer/api/public/session?token=token-1',
    })
    expect(tokens.list()).toEqual([])
    expect(messages.list()).toEqual([])
  })

  it('issues evaluation links with an evaluation purpose and no caller-selected destination', async () => {
    const { service, unitOfWork } = buildHarness()

    const response = await service.issueRoleAccess(organizerActor, {
      eventId: EVENT_ID,
      contactId: ownerContact.id,
      email: ownerContact.email,
      purpose: 'evaluation',
      subject: 'Your Open Events review link',
      renderBody: (accessUrl) => `Open your evaluation queue: ${accessUrl}`,
      kind: 'reminder',
      submissionId: null,
      proof: { kind: 'committee-member' },
    })

    expect(unitOfWork.issueRoleAccessCalls[0]?.token.purpose).toBe('evaluation')
    expect(unitOfWork.issueRoleAccessCalls[0]?.message).toMatchObject({
      subject: 'Your Open Events review link',
      body: expect.stringContaining('Open your evaluation queue:'),
    })
    expect(response).toMatchObject({
      accessUrl: 'https://www.openevents.engineer/api/public/session?token=token-1',
    })
  })

  it('requires non-forgeable organizer authority for direct role issuance', async () => {
    const { service, unitOfWork } = buildHarness()

    await expect(
      service.issueRoleAccess({} as never, {
        eventId: EVENT_ID,
        contactId: ownerContact.id,
        email: ownerContact.email,
        purpose: 'evaluation',
        subject: 'Review',
        renderBody: (accessUrl) => accessUrl,
        kind: 'reminder',
        submissionId: null,
        proof: { kind: 'committee-member' },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(unitOfWork.issueRoleAccessCalls).toEqual([])
  })

  it('legacy writer mode emits only null CFP credentials and refuses role links', async () => {
    const { service, unitOfWork } = buildHarness(null, {
      writerMode: 'legacy',
      legacyReaderMode: 'rollout',
    })

    await service.startSubmitter(
      startInput(),
      60_000,
      'https://www.openevents.engineer',
      startMailBudgetFixture(),
    )
    expect(unitOfWork.issueStartCalls[0]?.token).toMatchObject({ purpose: null })
    await expect(
      service.issueRoleAccess(organizerActor, {
        eventId: EVENT_ID,
        contactId: ownerContact.id,
        email: ownerContact.email,
        purpose: 'portal',
        subject: 'Portal',
        renderBody: (accessUrl) => accessUrl,
        kind: 'reminder',
        submissionId: null,
        proof: { kind: 'speaker-member', submissionId: null },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(unitOfWork.issueRoleAccessCalls).toEqual([])
  })

  it('redeems the token atomically with a session bound to the contact', async () => {
    const { service, unitOfWork, tokens, sessions } = buildHarness()
    await tokens.save(createSubmitterToken())

    const issued = await service.redeemSubmitterToken('token-1', 60_000)

    expect(issued.contactId).toBe(ownerContact.id)
    expect(issued.eventId).toBe(EVENT_ID)
    expect(issued).toMatchObject({ capability: 'cfp', redirectPath: '/cfp/demo-conf-2026/cfp' })
    expect(unitOfWork.redeemCalls).toHaveLength(1)
    const call = unitOfWork.redeemCalls[0]
    expect(call?.tokenId).toBe('token-id-1')
    expect(call?.consumedAt).toBe(FIXED_NOW)
    expect(call?.session).toMatchObject({
      kind: 'submitter',
      capability: 'cfp',
      contactId: ownerContact.id,
      eventId: EVENT_ID,
    })
    expect(sessions.list()).toEqual([])
  })

  it.each([
    ['portal', '/portal'],
    ['evaluation', '/evaluations'],
  ] as const)(
    'redeems a %s link only into its purpose-specific capability',
    async (purpose, path) => {
      const { service, unitOfWork, tokens } = buildHarness()
      await tokens.save(createSubmitterToken({ purpose, formId: null }))

      const issued = await service.redeemSubmitterToken('token-1', 60_000)

      expect(issued).toMatchObject({ capability: purpose, redirectPath: path })
      expect(unitOfWork.redeemCalls[0]?.session).toMatchObject({ capability: purpose })
    },
  )

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
    await sessions.save(createSubmitterSession({ capability: 'portal' }))

    await service.rotateSession('sub-token', 60_000)

    expect(unitOfWork.rotateCalls).toHaveLength(1)
    const call = unitOfWork.rotateCalls[0]
    expect(call?.sessionId).toBe('session-sub-1')
    expect(call?.consumedAt).toBe(FIXED_NOW)
    expect(call?.rotated).toMatchObject({
      kind: 'submitter',
      capability: 'portal',
      contactId: ownerContact.id,
      eventId: EVENT_ID,
    })
    expect(sessions.list()).toHaveLength(1)
    expect(sessions.list()[0]?.tokenHash).toBe('hash:sub-token')
  })

  it('rotates a bounded legacy-null session while preserving its lineage and broad marker source', async () => {
    const { service, unitOfWork, sessions } = buildHarness(FIXED_NOW)
    await sessions.save(createSubmitterSession({ capability: null, createdAt: FIXED_NOW }))

    await service.rotateSession('sub-token', 60_000)

    expect(unitOfWork.rotateCalls).toHaveLength(1)
    expect(unitOfWork.rotateCalls[0]?.rotated).toMatchObject({
      capability: null,
      createdAt: FIXED_NOW,
    })
  })

  it('only prepares CFP handoff authority; it cannot elevate without submit evidence', async () => {
    const { service, sessions } = buildHarness()
    await sessions.save(createSubmitterSession({ capability: 'cfp' }))

    const authorization = await service.authorizeCfpSubmit(
      'sub-token',
      {
        originDraftId: 'draft-1',
        formVersionId: VERSION_ID,
        title: 'Title',
        answers: {},
        coSpeakers: [],
      },
      60_000,
    )

    expect(authorization).toMatchObject({ mode: 'initial', cfpSessionId: 'session-sub-1' })
    expect(authorization.portalSession).toMatchObject({ capability: 'portal' })
  })

  it('never prepares CFP handoff authority for evaluation or portal sessions', async () => {
    const { service, sessions } = buildHarness()
    await sessions.save(createSubmitterSession({ capability: 'evaluation' }))

    await expect(
      service.authorizeCfpSubmit(
        'sub-token',
        {
          originDraftId: 'draft-1',
          formVersionId: VERSION_ID,
          title: 'Title',
          answers: {},
          coSpeakers: [],
        },
        60_000,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
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
