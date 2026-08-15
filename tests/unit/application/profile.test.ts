import { beforeEach, describe, expect, it } from 'vitest'

import { ProfileService, ValidationFailedError } from '../../../src/application'
import {
  FIXED_NOW,
  OWNER_CONTACT_ID,
  createSubmitterActor,
  ownerContact,
} from '../helpers/fixtures'
import {
  InMemoryContactRepository,
  InMemoryProgrammeRepository,
} from '../helpers/in-memory-repositories'

// O3 P1 (REQ-006): a signed-in speaker reads and updates their own persisted
// profile — name and bio — with identity taken only from the submitter actor.
// Email is read-only identity. Validation is server-side: non-empty name,
// bounded bio. No other contact is reachable through this surface.

const OTHER_CONTACT = {
  id: 'contact-speaker-b',
  email: 'speaker-b@example.test',
  name: 'Speaker B',
  createdAt: FIXED_NOW,
  bio: 'B secret bio',
}

let contacts: InMemoryContactRepository
let service: ProfileService

beforeEach(() => {
  contacts = new InMemoryContactRepository([{ ...ownerContact, bio: null }, OTHER_CONTACT])
  service = new ProfileService(contacts)
})

describe('getOwnProfile', () => {
  it('returns exactly the calling speaker profile', async () => {
    const profile = await service.getOwnProfile(createSubmitterActor())
    expect(profile).toEqual({
      name: 'Speaker A',
      email: 'speaker-a@example.test',
      bio: null,
      jobTitle: '',
      company: '',
    })
  })

  it('never returns another contact through the actor seam', async () => {
    const profile = await service.getOwnProfile(createSubmitterActor())
    expect(JSON.stringify(profile)).not.toContain('B secret bio')
    expect(JSON.stringify(profile)).not.toContain('speaker-b@example.test')
  })
})

describe('updateOwnProfile', () => {
  it('persists a trimmed name and bio for the calling speaker only', async () => {
    const updated = await service.updateOwnProfile(createSubmitterActor(), {
      name: '  Ada Lovelace  ',
      bio: '  First programmer. ',
    })
    expect(updated).toEqual({
      name: 'Ada Lovelace',
      email: 'speaker-a@example.test',
      bio: 'First programmer.',
      jobTitle: '',
      company: '',
    })
    const stored = await contacts.findById(OWNER_CONTACT_ID)
    expect(stored?.name).toBe('Ada Lovelace')
    expect(stored?.bio).toBe('First programmer.')
    const untouched = await contacts.findById('contact-speaker-b')
    expect(untouched?.bio).toBe('B secret bio')
  })

  it('clears the bio with an explicit empty string', async () => {
    await service.updateOwnProfile(createSubmitterActor(), { name: 'Ada', bio: 'x' })
    const cleared = await service.updateOwnProfile(createSubmitterActor(), { name: 'Ada', bio: '' })
    expect(cleared.bio).toBeNull()
  })

  it('persists job title and company on the speaker profile', async () => {
    const programme = new InMemoryProgrammeRepository()
    service = new ProfileService(contacts, programme, { now: () => FIXED_NOW })
    const updated = await service.updateOwnProfile(createSubmitterActor(), {
      name: 'Ada',
      bio: null,
      jobTitle: 'Staff Engineer',
      company: 'Northwind',
    })
    expect(updated.jobTitle).toBe('Staff Engineer')
    expect(updated.company).toBe('Northwind')
    expect(await service.getOwnProfile(createSubmitterActor())).toMatchObject({
      jobTitle: 'Staff Engineer',
      company: 'Northwind',
    })
  })

  it('rejects an empty name without persisting anything', async () => {
    await expect(
      service.updateOwnProfile(createSubmitterActor(), { name: '   ', bio: 'ok' }),
    ).rejects.toBeInstanceOf(ValidationFailedError)
    expect((await contacts.findById(OWNER_CONTACT_ID))?.name).toBe('Speaker A')
  })

  it('rejects an over-long bio', async () => {
    await expect(
      service.updateOwnProfile(createSubmitterActor(), { name: 'Ada', bio: 'x'.repeat(2001) }),
    ).rejects.toBeInstanceOf(ValidationFailedError)
  })

  it('rejects an over-long name', async () => {
    await expect(
      service.updateOwnProfile(createSubmitterActor(), { name: 'x'.repeat(201), bio: null }),
    ).rejects.toBeInstanceOf(ValidationFailedError)
  })

  it('never changes the email', async () => {
    const updated = await service.updateOwnProfile(createSubmitterActor(), {
      name: 'Ada',
      bio: null,
    })
    expect(updated.email).toBe('speaker-a@example.test')
    expect((await contacts.findById(OWNER_CONTACT_ID))?.email).toBe('speaker-a@example.test')
  })
})
