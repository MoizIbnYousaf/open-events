import { describe, expect, it } from 'vitest'

import { EventConfigService } from '../../../src/application'
import { eventFixture, organizerActor } from '../helpers/fixtures'
import { InMemoryEventRepository } from '../helpers/in-memory-repositories'

function buildHarness() {
  const events = new InMemoryEventRepository([eventFixture])
  const service = new EventConfigService(events, { now: () => '2026-08-14T12:00:00.000Z' })
  return { service }
}

describe('EventConfigService', () => {
  it('returns null for unknown events', async () => {
    const { service } = buildHarness()

    expect(await service.getBySlug(organizerActor, 'unknown-event')).toBeNull()
  })

  it('applies a partial update while preserving untouched fields', async () => {
    const { service } = buildHarness()

    const updated = await service.updateBySlug(organizerActor, 'demo-conf-2026', {
      websiteUrl: 'https://conf.example/2026',
      venue: 'Hamburg',
    })

    expect(updated.websiteUrl).toBe('https://conf.example/2026')
    expect(updated.venue).toBe('Hamburg')
    expect(updated.name).toBe(eventFixture.name)
    expect(updated.timezone).toBe('Europe/Berlin')
    expect(updated.startsAt).toBe(eventFixture.dates?.startsAt ?? null)
    expect(updated.organizerContact).toBe('team@example.test')
  })

  it('rejects an invalid timezone and an inverted date range', async () => {
    const { service } = buildHarness()

    const timezoneFailure = await service
      .updateBySlug(organizerActor, 'demo-conf-2026', { timezone: 'Not/A Timezone!' })
      .catch((error: unknown) => error)
    expect(timezoneFailure).toMatchObject({ code: 'validation_failed' })
    expect(
      (timezoneFailure as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('invalid_timezone')

    const dateFailure = await service
      .updateBySlug(organizerActor, 'demo-conf-2026', {
        dates: {
          startsAt: '2026-05-15T17:00:00.000Z',
          endsAt: '2026-05-13T08:00:00.000Z',
        },
      })
      .catch((error: unknown) => error)
    expect(
      (dateFailure as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('invalid_date_range')
  })

  it('rejects updates to unknown events', async () => {
    const { service } = buildHarness()

    await expect(
      service.updateBySlug(organizerActor, 'unknown-event', { venue: 'X' }),
    ).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})
