import { describe, expect, it } from 'vitest'

import { DraftService, SessionService, toSubmitterActor } from '../../../src/application'
import { getSessionContactId } from '../../../src/domain'
import {
  DRAFT_ID,
  EVENT_ID,
  FIXED_NOW,
  FORM_ID,
  NOW,
  VERSION_ID,
  createDraft,
  createForm,
  createOrganizerSession,
  createSubmitterSession,
  createSubmitterToken,
  createVersion,
  eventFixture,
  foreignActor,
  ownerActor,
  ownerContact,
} from '../helpers/fixtures'
import {
  InMemoryCapturedMessageRepository,
  InMemoryContactRepository,
  InMemoryDraftRepository,
  InMemoryEventRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemorySessionRepository,
  InMemoryTokenRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySessionUnitOfWork } from '../helpers/in-memory-unit-of-work'

function buildSessionHarness() {
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
  return { service, sessions, tokens }
}

describe('session identity contract', () => {
  it('exposes the identity subject only for submitter sessions', () => {
    expect(getSessionContactId(createSubmitterSession())).toBe(ownerContact.id)
    expect(getSessionContactId(createOrganizerSession())).toBeNull()
  })

  it('binds the redeemed contact and event to the persisted submitter session', async () => {
    const { service, sessions, tokens } = buildSessionHarness()
    await tokens.save(createSubmitterToken())

    await service.redeemSubmitterToken('token-1', 60_000)

    const session = sessions.list()[0]
    expect(session?.kind).toBe('submitter')
    expect(session).toMatchObject({ contactId: ownerContact.id, eventId: EVENT_ID })
    expect(await service.validateSession('token-1')).toMatchObject({
      kind: 'submitter',
      contactId: ownerContact.id,
      eventId: EVENT_ID,
    })
  })

  it('preserves contact and event across submitter rotation and omits both for organizers', async () => {
    const { service, sessions } = buildSessionHarness()
    await sessions.save(createSubmitterSession())

    await service.rotateSession('sub-token', 60_000)

    const rotated = sessions.list().find((session) => session.tokenHash === 'hash:token-1')
    expect(rotated).toMatchObject({
      kind: 'submitter',
      contactId: ownerContact.id,
      eventId: EVENT_ID,
    })

    const organizer = buildSessionHarness()
    await organizer.service.organizerLogin('secret', 'secret', 60_000)
    await organizer.service.rotateSession('token-1', 60_000)
    const rotatedOrganizer = organizer.sessions
      .list()
      .find((session) => session.tokenHash === 'hash:token-2')
    expect(rotatedOrganizer?.kind).toBe('organizer')
    expect(rotatedOrganizer).not.toHaveProperty('contactId')
  })
})

describe('actor-scope denial', () => {
  it('a second identity cannot obtain the first identity draft', async () => {
    const form = createForm({ status: 'published', publishedVersionId: VERSION_ID })
    const version = createVersion({
      status: 'published',
      contentHash: 'hash',
      publishedAt: NOW,
    })
    const drafts = new InMemoryDraftRepository([createDraft()])
    const service = new DraftService(
      drafts,
      new InMemoryFormRepository([form]),
      new InMemoryFormVersionRepository([version]),
      { now: () => FIXED_NOW },
    )

    expect(await service.get(ownerActor, DRAFT_ID)).toMatchObject({ id: DRAFT_ID })
    expect(await service.get(foreignActor, DRAFT_ID)).toBeNull()
    await expect(
      service.save(foreignActor, {
        id: DRAFT_ID,
        formId: FORM_ID,
        formVersionId: VERSION_ID,
        title: 'hijack',
        answers: {},
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a session from event A cannot authorize event B draft access', async () => {
    const form = createForm({ status: 'published', publishedVersionId: VERSION_ID })
    const version = createVersion({
      status: 'published',
      contentHash: 'hash',
      publishedAt: NOW,
    })
    const drafts = new InMemoryDraftRepository([createDraft()])
    const service = new DraftService(
      drafts,
      new InMemoryFormRepository([form]),
      new InMemoryFormVersionRepository([version]),
      { now: () => FIXED_NOW },
    )
    const session = createSubmitterSession()
    const actor = toSubmitterActor(session)
    const crossEventActor = toSubmitterActor(createSubmitterSession({ eventId: 'event-other' }))

    expect(actor).not.toBeNull()
    expect(crossEventActor).not.toBeNull()
    expect(await service.get(crossEventActor!, DRAFT_ID)).toBeNull()
  })
})
