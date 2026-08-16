import { describe, expect, it } from 'vitest'

import { deleteAcceptanceEventObjects } from '../../../src/server/routes/acceptance-reset'
import { InMemoryObjectStorage } from '../helpers/in-memory-repositories'

const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'

describe('acceptance R2 reset', () => {
  it('collects every page before deleting only the exact event prefix', async () => {
    const storage = new InMemoryObjectStorage()
    const target = Array.from({ length: 5 }, (_, index) => `events/${EVENT_ID}/objects/${index}`)
    for (const key of [...target, 'events/other/objects/0']) {
      await storage.put(key, new ArrayBuffer(1), 'application/octet-stream')
    }
    expect(await deleteAcceptanceEventObjects(storage, EVENT_ID)).toEqual(target)
    expect([...storage.objects.keys()]).toEqual(['events/other/objects/0'])
  })

  it('refuses an empty or path-shaped event id', async () => {
    await expect(deleteAcceptanceEventObjects(new InMemoryObjectStorage(), '../')).rejects.toThrow(
      'unsafe_event_id',
    )
  })
})
