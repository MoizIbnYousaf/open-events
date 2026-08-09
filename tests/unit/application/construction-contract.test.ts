import { describe, expect, it } from 'vitest'

import {
  DraftService,
  FormBuilderService,
  SessionService,
  SubmitService,
  type SaveDraftInput,
  type StartInput,
  type SubmitInput,
  type SubmitUnitOfWork,
} from '../../../src/application'
import { EVENT_ID, createForm, eventFixture, ownerContact } from '../helpers/fixtures'
import {
  InMemoryContactRepository,
  InMemoryDraftRepository,
  InMemoryEventRepository,
  InMemoryFormContentRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemorySessionRepository,
  InMemorySubmissionRepository,
  InMemoryTaxonomyRepository,
  InMemoryTokenRepository,
} from '../helpers/in-memory-repositories'

function baseRepos() {
  const drafts = new InMemoryDraftRepository()
  const versions = new InMemoryFormVersionRepository()
  const submissions = new InMemorySubmissionRepository(versions)
  const contacts = new InMemoryContactRepository([ownerContact])
  const events = new InMemoryEventRepository([eventFixture])
  const forms = new InMemoryFormRepository([createForm()])
  const content = new InMemoryFormContentRepository()
  const taxonomies = new InMemoryTaxonomyRepository()
  const tokens = new InMemoryTokenRepository()
  const sessions = new InMemorySessionRepository()
  return {
    drafts,
    versions,
    submissions,
    contacts,
    events,
    forms,
    content,
    taxonomies,
    tokens,
    sessions,
  }
}

const clock = { now: () => '2026-05-15T00:00:00.000Z' }

const closedUnitOfWork: SubmitUnitOfWork = {
  async execute() {
    return { outcome: 'closed' }
  },
}

describe('mandatory unit-of-work and clock construction', () => {
  it('SubmitService cannot be constructed without a SubmitUnitOfWork and Clock', () => {
    const { drafts, submissions, contacts, forms, versions, content } = baseRepos()

    // @ts-expect-error SubmitService requires a SubmitUnitOfWork and Clock
    new SubmitService(drafts, submissions, contacts, forms, versions, content)
  })

  it('FormBuilderService cannot be constructed without a FormBuilderUnitOfWork and Clock', () => {
    const { events, forms, versions, content, taxonomies } = baseRepos()

    // @ts-expect-error FormBuilderService requires a FormBuilderUnitOfWork and Clock
    new FormBuilderService(events, forms, versions, content, taxonomies)
  })

  it('SessionService cannot be constructed without a SessionUnitOfWork and Clock', () => {
    const { tokens, sessions, contacts, events, forms } = baseRepos()
    const hasher = {
      async hash(token: string): Promise<string> {
        return token
      },
    }
    const generator = {
      async generate(): Promise<string> {
        return 'token'
      },
    }

    // @ts-expect-error SessionService requires a SessionUnitOfWork and Clock
    new SessionService(tokens, sessions, contacts, events, forms, hasher, generator)
  })

  it('DraftService cannot be constructed without forms, versions, and a clock', () => {
    const { drafts } = baseRepos()

    // @ts-expect-error DraftService requires forms, versions, and a clock
    new DraftService(drafts)
  })

  it('accepts fully wired constructions at the type level', () => {
    const {
      drafts,
      versions,
      submissions,
      contacts,
      events,
      forms,
      content,
      taxonomies,
      tokens,
      sessions,
    } = baseRepos()
    const hasher = {
      async hash(token: string): Promise<string> {
        return token
      },
    }
    const generator = {
      async generate(): Promise<string> {
        return 'token'
      },
    }
    const formBuilderUnitOfWork = {
      async saveDraft() {
        return { outcome: 'saved' as const }
      },
      async publish() {
        return { outcome: 'published' as const }
      },
    }
    const sessionUnitOfWork = {
      async issueStart() {},
      async redeemSubmitterToken() {
        return { outcome: 'redeemed' as const }
      },
      async rotateSession() {
        return { outcome: 'rotated' as const }
      },
    }

    new SubmitService(
      drafts,
      submissions,
      contacts,
      forms,
      versions,
      content,
      closedUnitOfWork,
      clock,
    )
    new FormBuilderService(
      events,
      forms,
      versions,
      content,
      taxonomies,
      formBuilderUnitOfWork,
      clock,
    )
    new SessionService(
      tokens,
      sessions,
      contacts,
      events,
      forms,
      hasher,
      generator,
      sessionUnitOfWork,
      clock,
    )
    new DraftService(drafts, forms, versions, clock)
    expect(true).toBe(true)
  })
})

describe('owner, event, and clock fields are absent from request DTOs', () => {
  it('SubmitInput cannot carry eventId, ownerContactId, or now', () => {
    const withEvent: SubmitInput = {
      originDraftId: 'draft-1',
      // @ts-expect-error eventId is derived from the session actor, never the body
      eventId: EVENT_ID,
      formVersionId: 'version-1',
      title: 't',
      answers: {},
      coSpeakers: [],
    }
    void withEvent

    const withOwner: SubmitInput = {
      originDraftId: 'draft-1',
      // @ts-expect-error ownerContactId is derived from the session actor, never the body
      ownerContactId: 'contact-1',
      formVersionId: 'version-1',
      title: 't',
      answers: {},
      coSpeakers: [],
    }
    void withOwner

    const withNow: SubmitInput = {
      originDraftId: 'draft-1',
      // @ts-expect-error the submission instant comes from the service clock
      now: '2026-05-15T00:00:00.000Z',
      formVersionId: 'version-1',
      title: 't',
      answers: {},
      coSpeakers: [],
    }
    void withNow
  })

  it('SaveDraftInput cannot carry eventId or ownerContactId', () => {
    const withEvent: SaveDraftInput = {
      id: null,
      // @ts-expect-error eventId is derived from the session actor
      eventId: EVENT_ID,
      formId: 'form-1',
      formVersionId: 'version-1',
      title: 't',
      answers: {},
    }
    void withEvent

    const withOwner: SaveDraftInput = {
      id: null,
      // @ts-expect-error ownerContactId is derived from the session actor
      ownerContactId: 'contact-1',
      formId: 'form-1',
      formVersionId: 'version-1',
      title: 't',
      answers: {},
    }
    void withOwner
  })

  it('StartInput cannot carry an event id', () => {
    const withEventId: StartInput = {
      email: 'speaker-a@example.test',
      eventSlug: 'demo-conf-2026',
      formSlug: 'cfp',
      // @ts-expect-error the server resolves the event from the eventSlug
      eventId: EVENT_ID,
    }
    void withEventId
  })
})
