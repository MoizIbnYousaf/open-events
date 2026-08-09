import { describe, expect, it } from 'vitest'

import { SessionService, type StartInput } from '../../../src/application'
import {
  EVENT_ID,
  EVENT_SLUG,
  FIXED_NOW,
  FORM_SLUG,
  VERSION_ID,
  createForm,
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
import { InMemorySessionUnitOfWork } from '../helpers/in-memory-unit-of-work'

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
  return { service, contacts, tokens }
}

function startInput(email: string): StartInput {
  return { email, eventSlug: EVENT_SLUG, formSlug: FORM_SLUG }
}

describe('atomic contact upsert dedupe', () => {
  it('concurrent startSubmitter calls for one email converge on a single contact', async () => {
    const { service, contacts, tokens } = buildHarness()
    const email = 'new-speaker@example.test'

    await Promise.all([
      service.startSubmitter(startInput(email), 60_000, () => 'link'),
      service.startSubmitter(startInput(email), 60_000, () => 'link'),
    ])

    expect(contacts.list()).toHaveLength(2)
    const created = contacts.list().find((contact) => contact.email === email)
    expect(created).not.toBeNull()
    const tokenContacts = tokens.list().map((token) => token.contactId)
    expect(tokenContacts).toHaveLength(2)
    expect(tokenContacts[0]).toBe(created?.id)
    expect(tokenContacts[1]).toBe(created?.id)
  })

  it('a pre-existing contact is reused without a second insert', async () => {
    const { service, contacts, tokens } = buildHarness()

    await service.startSubmitter(startInput('Speaker-A@Example.TEST'), 60_000, () => 'link')

    expect(contacts.list()).toHaveLength(1)
    expect(contacts.list()[0]?.id).toBe(ownerContact.id)
    expect(tokens.list()[0]?.contactId).toBe(ownerContact.id)
  })

  it('each token carries the event context of its start', async () => {
    const { service, tokens } = buildHarness()

    await service.startSubmitter(startInput('speaker-a@example.test'), 60_000, () => 'link')

    expect(tokens.list()[0]?.eventId).toBe(EVENT_ID)
  })
})
