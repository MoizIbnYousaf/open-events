import { describe, expect, it } from 'vitest'

import {
  OrganizerActor,
  SubmitterActor,
  toOrganizerActor,
  toSubmitterActor,
} from '../../../src/application'
import {
  EVENT_ID,
  OWNER_CONTACT_ID,
  createOrganizerSession,
  createSubmitterSession,
} from '../helpers/fixtures'

describe('actor narrowing factories', () => {
  it('derives a submitter actor carrying the session contactId and eventId', () => {
    const session = createSubmitterSession()

    const actor = toSubmitterActor(session)

    expect(actor).not.toBeNull()
    expect(actor?.contactId).toBe(OWNER_CONTACT_ID)
    expect(actor?.eventId).toBe(EVENT_ID)
  })

  it('never fabricates identity: actor fields equal the source session fields', () => {
    const session = createSubmitterSession({
      contactId: 'contact-custom',
      eventId: 'event-custom',
    })

    const actor = toSubmitterActor(session)

    expect(actor?.contactId).toBe('contact-custom')
    expect(actor?.eventId).toBe('event-custom')
  })

  it('returns null when deriving a submitter actor from an organizer session', () => {
    expect(toSubmitterActor(createOrganizerSession())).toBeNull()
  })

  it('derives an organizer actor from an organizer session', () => {
    const actor = toOrganizerActor(createOrganizerSession())

    expect(actor).not.toBeNull()
    expect(actor?.kind).toBe('organizer')
  })

  it('an organizer actor exposes no contactId member', () => {
    const actor = toOrganizerActor(createOrganizerSession())

    expect(actor).not.toBeNull()
    expect(actor?.kind).toBe('organizer')
    expect(actor).not.toHaveProperty('contactId')
  })

  it('returns null when deriving an organizer actor from a submitter session', () => {
    expect(toOrganizerActor(createSubmitterSession())).toBeNull()
  })

  it('mirrors the narrowing functions through the static fromSession helpers', () => {
    const submitter = createSubmitterSession()
    const organizer = createOrganizerSession()

    expect(SubmitterActor.fromSession(submitter)?.contactId).toBe(OWNER_CONTACT_ID)
    expect(SubmitterActor.fromSession(organizer)).toBeNull()
    expect(OrganizerActor.fromSession(organizer)?.kind).toBe('organizer')
    expect(OrganizerActor.fromSession(submitter)).toBeNull()
  })
})

describe('compile-time non-forgeability', () => {
  it('plain submitter object literals cannot satisfy SubmitterActor', () => {
    // @ts-expect-error SubmitterActor carries a private brand
    const forged: SubmitterActor = { contactId: OWNER_CONTACT_ID, eventId: EVENT_ID }
    void forged
  })

  it('plain organizer object literals cannot satisfy OrganizerActor', () => {
    // @ts-expect-error OrganizerActor carries a private brand
    const forged: OrganizerActor = { kind: 'organizer' }
    void forged
  })

  it('submitter actors cannot be constructed directly', () => {
    // @ts-expect-error SubmitterActor has a private constructor
    new SubmitterActor(OWNER_CONTACT_ID, EVENT_ID)
  })

  it('organizer actors cannot be constructed directly', () => {
    // @ts-expect-error OrganizerActor has a private constructor
    new OrganizerActor()
  })

  it('organizer-only methods reject submitter actors', () => {
    const requireOrganizer = (actor: OrganizerActor): OrganizerActor => actor
    const actor = toSubmitterActor(createSubmitterSession())!

    // @ts-expect-error a SubmitterActor is not an OrganizerActor
    requireOrganizer(actor)
  })

  it('submitter-only methods reject organizer actors', () => {
    const requireSubmitter = (actor: SubmitterActor): SubmitterActor => actor
    const actor = toOrganizerActor(createOrganizerSession())!

    // @ts-expect-error an OrganizerActor is not a SubmitterActor
    requireSubmitter(actor)
  })
})
