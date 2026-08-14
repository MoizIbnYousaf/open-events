import { describe, expect, it } from 'vitest'

import {
  DraftService,
  SessionService,
  publicCfpPath,
  toSubmitterActor,
  type StartInput,
} from '../../../src/application'
import {
  DRAFT_ID,
  EVENT_ID,
  EVENT_SLUG,
  FIXED_NOW,
  FORM_ID,
  FORM_SLUG,
  NOW,
  VERSION_ID,
  createDraft,
  createForm,
  createSubmitterSession,
  createVersion,
  eventFixture,
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

describe('two-segment public path', () => {
  it('builds the canonical clean /cfp/:eventSlug/:formSlug path', () => {
    expect(publicCfpPath(EVENT_SLUG, FORM_SLUG)).toBe('/cfp/demo-conf-2026/cfp')
    expect(publicCfpPath('Demo Conf', 'my form')).toBe('/cfp/Demo%20Conf/my%20form')
  })
})

describe('start input contract', () => {
  it('requires email plus eventSlug and formSlug, never an event id', () => {
    const input: StartInput = {
      email: 'speaker-a@example.test',
      eventSlug: EVENT_SLUG,
      formSlug: FORM_SLUG,
    }
    expect(input.email).toBe('speaker-a@example.test')
    expect(input.eventSlug).toBe(EVENT_SLUG)
    expect(input.formSlug).toBe(FORM_SLUG)
    expect(input).not.toHaveProperty('eventId')
  })
})

describe('session event context reaches the active-draft read', () => {
  it('derives the actor from the redeemed session and scopes getActiveDraft by event and form', async () => {
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
    const generator = {
      async generate(): Promise<string> {
        return 'token-1'
      },
    }
    const sessionService = new SessionService(
      tokens,
      sessions,
      contacts,
      events,
      forms,
      hasher,
      generator,
      unitOfWork,
      { now: () => FIXED_NOW },
    )
    await tokens.save({
      id: 'token-id-1',
      contactId: ownerActor.contactId,
      eventId: EVENT_ID,
      formId: FORM_ID,
      tokenHash: 'hash:token-1',
      expiresAt: '2026-05-21T00:00:00.000Z',
      consumedAt: null,
      createdAt: FIXED_NOW,
    })
    const redeemed = await sessionService.redeemSubmitterToken('token-1', 60_000)
    expect(redeemed.eventId).toBe(EVENT_ID)
    expect(redeemed.contactId).toBe(ownerActor.contactId)

    const session = await sessionService.validateSession('token-1')
    expect(session?.kind).toBe('submitter')
    const actor = session?.kind === 'submitter' ? toSubmitterActor(session) : null
    const crossEventActor = toSubmitterActor(createSubmitterSession({ eventId: 'event-other' }))

    const form = createForm({ status: 'published', publishedVersionId: VERSION_ID })
    const version = createVersion({
      status: 'published',
      contentHash: 'hash',
      publishedAt: NOW,
    })
    const drafts = new InMemoryDraftRepository([createDraft()])
    const draftService = new DraftService(
      drafts,
      new InMemoryFormRepository([form]),
      new InMemoryFormVersionRepository([version]),
      { now: () => FIXED_NOW },
    )

    expect(actor).not.toBeNull()
    expect(await draftService.getActiveDraft(actor!, FORM_ID)).toMatchObject({ id: DRAFT_ID })
    expect(crossEventActor).not.toBeNull()
    expect(await draftService.getActiveDraft(crossEventActor!, FORM_ID)).toBeNull()
  })
})
