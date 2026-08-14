import { describe, expect, it } from 'vitest'

import { publicSessionFacets, slugifyEventName, uniqueEventSlug } from '../../../src/domain'
import { toIcsCalendar } from '../../../src/domain/calendar'
import { zipStoreFiles } from '../../../src/domain/zip-store'

describe('publicSessionFacets', () => {
  it('reads format from optionsSource and description from the first long_text', () => {
    const facets = publicSessionFacets(
      {
        pages: [
          {
            id: 'p1',
            eventId: 'e',
            versionId: 'v',
            position: 0,
            kind: 'info',
            title: 'Info',
            content: '',
          },
        ],
        elements: [
          {
            id: 'f',
            eventId: 'e',
            versionId: 'v',
            pageId: 'p1',
            position: 0,
            kind: 'question',
            fieldKey: 'fmt',
            label: 'Format',
            required: true,
            maxLength: null,
            questionType: 'single_choice',
            options: ['Talk'],
            optionsSource: 'format',
          },
          {
            id: 'a',
            eventId: 'e',
            versionId: 'v',
            pageId: 'p1',
            position: 1,
            kind: 'question',
            fieldKey: 'blurb',
            label: 'Abstract',
            required: true,
            maxLength: 2000,
            questionType: 'long_text',
            options: [],
            optionsSource: null,
          },
        ],
        conditionRules: [],
        routingRules: [],
      },
      { fmt: 'Talk', blurb: 'A long abstract.' },
    )
    expect(facets).toEqual({ format: 'Talk', description: 'A long abstract.' })
  })
})

describe('event slugs', () => {
  it('slugifies a name and avoids collisions', () => {
    expect(slugifyEventName('Forward Summit 2028')).toBe('forward-summit-2028')
    expect(uniqueEventSlug('demo-conf-2026', new Set(['demo-conf-2026']))).toBe('demo-conf-2026-2')
  })
})

describe('ics and zip', () => {
  it('emits a VCALENDAR with the session title', () => {
    const ics = toIcsCalendar('Demo', [
      {
        uid: 's1@open-events',
        title: 'My talk',
        start: '2026-05-13T09:00:00.000Z',
        end: '2026-05-13T10:00:00.000Z',
        location: 'Main hall',
        description: 'Hello',
      },
    ])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('SUMMARY:My talk')
    expect(ics).toContain('LOCATION:Main hall')
  })

  it('packs files into a zip that starts with the local-file signature', () => {
    const zip = zipStoreFiles([{ name: 'a.txt', body: new TextEncoder().encode('hi') }])
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
    expect(zip.length).toBeGreaterThan(30)
  })
})
