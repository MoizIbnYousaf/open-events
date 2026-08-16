import { describe, expect, it } from 'vitest'

import type { OrganizerSession, SubmitterSession } from '../../../src/domain'
import { validateSessionIdentity } from '../../../src/domain'
import {
  EVENT_ID,
  NOW,
  OWNER_CONTACT_ID,
  createDecodedSessionRow,
  createOrganizerSession,
  createSubmitterSession,
} from '../helpers/fixtures'

function rowCodes(row: Parameters<typeof validateSessionIdentity>[0]): readonly string[] {
  return validateSessionIdentity(row).map((issue) => issue.code)
}

describe('session row decoding contract', () => {
  it('accepts a valid submitter row with contactId and eventId', () => {
    expect(validateSessionIdentity(createDecodedSessionRow())).toEqual([])
  })

  it('rejects submitter rows with null or empty contactId', () => {
    expect(rowCodes(createDecodedSessionRow({ contactId: null }))).toContain(
      'submitter_without_contact',
    )
    expect(rowCodes(createDecodedSessionRow({ contactId: '' }))).toContain(
      'submitter_without_contact',
    )
  })

  it('rejects submitter rows with missing or empty eventId', () => {
    expect(rowCodes(createDecodedSessionRow({ eventId: undefined }))).toContain(
      'submitter_without_event',
    )
    expect(rowCodes(createDecodedSessionRow({ eventId: '' }))).toContain('submitter_without_event')
  })

  it('accepts organizer rows with a null contactId', () => {
    expect(
      validateSessionIdentity(
        createDecodedSessionRow({
          kind: 'organizer',
          contactId: null,
          eventId: undefined,
          capability: null,
        }),
      ),
    ).toEqual([])
  })

  it('rejects organizer rows with a non-null contactId', () => {
    expect(
      rowCodes(createDecodedSessionRow({ kind: 'organizer', contactId: OWNER_CONTACT_ID })),
    ).toContain('organizer_with_contact')
  })

  it('rejects organizer rows with a non-null eventId', () => {
    const issues = validateSessionIdentity(
      createDecodedSessionRow({ kind: 'organizer', contactId: null, eventId: EVENT_ID }),
    )

    expect(issues.map((issue) => issue.code)).toEqual(['organizer_with_event'])
    expect(issues[0]?.message).toBe('An organizer session must not carry an eventId')
  })
})

describe('discriminated session literals', () => {
  it('organizer application sessions have no contactId member', () => {
    const session: OrganizerSession = createOrganizerSession()

    expect(session).not.toHaveProperty('contactId')
  })

  it('submitter session literals require contactId and eventId', () => {
    // @ts-expect-error a submitter session requires a contactId
    const missingContact: SubmitterSession = {
      id: 'session-bad',
      kind: 'submitter',
      tokenHash: 'hash',
      expiresAt: NOW,
      consumedAt: null,
      createdAt: NOW,
    }
    void missingContact

    // @ts-expect-error a submitter session requires an eventId
    const missingEvent: SubmitterSession = {
      id: 'session-bad',
      kind: 'submitter',
      contactId: OWNER_CONTACT_ID,
      tokenHash: 'hash',
      expiresAt: NOW,
      consumedAt: null,
      createdAt: NOW,
    }
    void missingEvent
  })

  it('organizer session literals cannot carry a contactId', () => {
    const withContact: OrganizerSession = {
      ...createOrganizerSession(),
      // @ts-expect-error organizer sessions have no contactId member
      contactId: OWNER_CONTACT_ID,
    }
    void withContact
  })

  it('preserves the discriminated shape through the public submitter session', () => {
    const session = createSubmitterSession()
    expect(session.kind).toBe('submitter')
    expect(session.contactId).toBe(OWNER_CONTACT_ID)
    expect(session.eventId).toBe(EVENT_ID)
  })
})
