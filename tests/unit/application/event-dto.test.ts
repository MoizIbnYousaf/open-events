import { describe, expect, it } from 'vitest'

import { toEventDto, type EventDto } from '../../../src/application'
import type { Event } from '../../../src/domain'

const event: Event = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: 'demo-conf-2026',
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  dates: {
    startsAt: '2026-05-13T08:00:00.000Z',
    endsAt: '2026-05-15T17:00:00.000Z',
  },
}

describe('toEventDto', () => {
  it('flattens the domain dates into public startsAt/endsAt instants', () => {
    const expected: EventDto = {
      id: event.id,
      slug: event.slug,
      name: event.name,
      timezone: event.timezone,
      status: event.status,
      startsAt: '2026-05-13T08:00:00.000Z',
      endsAt: '2026-05-15T17:00:00.000Z',
      logoUrl: null,
      logoWidth: null,
      logoHeight: null,
      logoUpdatedAt: null,
      backgroundUrl: null,
      backgroundWidth: null,
      backgroundHeight: null,
      backgroundUpdatedAt: null,
    }

    expect(toEventDto(event)).toEqual(expected)
  })

  it('maps a missing date window to null instants', () => {
    const expected: EventDto = {
      id: event.id,
      slug: event.slug,
      name: event.name,
      timezone: event.timezone,
      status: event.status,
      startsAt: null,
      endsAt: null,
      logoUrl: null,
      logoWidth: null,
      logoHeight: null,
      logoUpdatedAt: null,
      backgroundUrl: null,
      backgroundWidth: null,
      backgroundHeight: null,
      backgroundUpdatedAt: null,
    }

    expect(toEventDto({ ...event, dates: null })).toEqual(expected)
  })

  it('preserves identity and vocabulary fields unchanged', () => {
    const dto = toEventDto(event)

    expect(dto.id).toBe(event.id)
    expect(dto.slug).toBe(event.slug)
    expect(dto.name).toBe(event.name)
    expect(dto.timezone).toBe(event.timezone)
    expect(dto.status).toBe(event.status)
  })
})
