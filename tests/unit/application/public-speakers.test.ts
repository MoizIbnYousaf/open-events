import { describe, expect, it } from 'vitest'

import {
  applySessionCardsToPeople,
  isPubliclyVisible,
  toPublicSpeakers,
  type PublicSessionView,
} from '../../../src/application/services/public-programme'
import type { AgendaSessionRecord } from '../../../src/application/ports/agenda-repository'

const SESSION: PublicSessionView = {
  submissionId: 's1',
  title: 'Taming 40-Minute CI',
  speakers: ['Priya Raman'],
  speakerCards: [{ name: 'Priya Raman', jobTitle: 'Staff', company: 'Northwind' }],
  track: 'Platform',
  room: '2A',
  day: '2027-05-12',
  start: '2027-05-12T10:00:00.000Z',
  end: '2027-05-12T10:40:00.000Z',
  position: 0,
  format: 'Talk',
  description: '',
}

const PUBLISHED: AgendaSessionRecord = {
  eventId: 'evt',
  submissionId: 's1',
  trackId: null,
  roomId: null,
  day: '2027-05-12',
  start: '2027-05-12T10:00:00.000Z',
  end: '2027-05-12T10:40:00.000Z',
  position: 0,
  assignment: 'scheduled',
  status: 'published',
  speakerIds: [],
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:00:00.000Z',
}

describe('isPubliclyVisible', () => {
  it('keeps a published session public while a speaker edit is still draft', () => {
    expect(isPubliclyVisible(PUBLISHED, new Set(), new Map([['s1', 'draft']]), new Set(['s1']))).toBe(
      true,
    )
    expect(isPubliclyVisible(PUBLISHED, new Set(), new Map([['s1', 'draft']]))).toBe(false)
  })
})

describe('toPublicSpeakers', () => {
  it('exposes a public headshot URL only when a photo exists', () => {
    const listed = toPublicSpeakers(
      [SESSION],
      [
        {
          id: 'c-priya',
          name: 'Priya Raman',
          bio: 'Builds.',
          hasHeadshot: true,
          jobTitle: 'Staff',
          company: 'Northwind',
        },
        {
          id: 'c-hidden',
          name: 'Hidden',
          bio: '',
          hasHeadshot: false,
          jobTitle: '',
          company: '',
        },
      ],
      'demo-conf-2026',
    )
    expect(listed).toHaveLength(1)
    expect(listed[0]?.photoUrl).toBe(
      '/api/public/events/demo-conf-2026/speakers/c-priya/headshot',
    )
  })

  it('fills empty roster title and company from the published session cards', () => {
    const filled = applySessionCardsToPeople(
      [{ name: 'Priya Raman', jobTitle: '', company: '' }],
      [SESSION],
    )
    expect(filled[0]).toEqual({
      name: 'Priya Raman',
      jobTitle: 'Staff',
      company: 'Northwind',
    })
  })
})
