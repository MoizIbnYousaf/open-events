import { describe, expect, it } from 'vitest'

import { TaxonomyService } from '../../../src/application'
import { EVENT_ID, createTaxonomyItem, eventFixture, organizerActor } from '../helpers/fixtures'
import {
  InMemoryEventRepository,
  InMemoryTaxonomyRepository,
} from '../helpers/in-memory-repositories'

function buildHarness() {
  const events = new InMemoryEventRepository([eventFixture])
  const taxonomies = new InMemoryTaxonomyRepository([[EVENT_ID, [createTaxonomyItem()]]])
  const service = new TaxonomyService(events, taxonomies)
  return { service, taxonomies }
}

describe('TaxonomyService', () => {
  it('returns the event taxonomy list or null for unknown events', async () => {
    const { service } = buildHarness()

    const list = await service.getByEventSlug(organizerActor, 'demo-conf-2026')
    expect(list?.eventId).toBe(EVENT_ID)
    expect(list?.items.map((item) => item.key)).toEqual(['workshop'])
    expect(await service.getByEventSlug(organizerActor, 'unknown-event')).toBeNull()
  })

  it('replaces the taxonomy when valid', async () => {
    const { service, taxonomies } = buildHarness()

    const replaced = await service.replaceByEventSlug(organizerActor, 'demo-conf-2026', {
      items: [
        { kind: 'track', key: 'workshop', label: 'Workshop', position: 0 },
        { kind: 'track', key: 'talk', label: 'Talk', position: 1 },
      ],
    })

    expect(replaced.items).toHaveLength(2)
    expect((await taxonomies.listByEvent(EVENT_ID)).map((item) => item.key)).toEqual([
      'workshop',
      'talk',
    ])
  })

  it('rejects duplicate keys, empty keys, and bad positions without persisting', async () => {
    const { service, taxonomies } = buildHarness()

    const duplicate = await service
      .replaceByEventSlug(organizerActor, 'demo-conf-2026', {
        items: [
          { kind: 'track', key: 'workshop', label: 'A', position: 0 },
          { kind: 'track', key: 'workshop', label: 'B', position: 1 },
        ],
      })
      .catch((error: unknown) => error)
    const emptyKey = await service
      .replaceByEventSlug(organizerActor, 'demo-conf-2026', {
        items: [{ kind: 'tag', key: ' ', label: 'A', position: 0 }],
      })
      .catch((error: unknown) => error)
    const badPosition = await service
      .replaceByEventSlug(organizerActor, 'demo-conf-2026', {
        items: [{ kind: 'tag', key: 'x', label: 'A', position: -1 }],
      })
      .catch((error: unknown) => error)

    expect(
      (duplicate as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('duplicate_key')
    expect(
      (emptyKey as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('empty_key')
    expect(
      (badPosition as { issues: readonly { code: string }[] }).issues.map((i) => i.code),
    ).toContain('invalid_position')
    expect((await taxonomies.listByEvent(EVENT_ID)).map((item) => item.key)).toEqual(['workshop'])
  })
})
