import { describe, expect, it } from 'vitest'

import {
  BRANDING_BACKGROUND_MAX_BYTES,
  BRANDING_LOGO_MAX_BYTES,
  BrandingImageInvalidError,
  EventBrandingService,
  inspectBrandingImage,
} from '../../../src/application'
import { organizerActor, eventFixture, FIXED_NOW } from '../helpers/fixtures'
import { InMemoryEventRepository, InMemoryObjectStorage } from '../helpers/in-memory-repositories'

function png(width: number, height: number, length = 64): ArrayBuffer {
  const bytes = new Uint8Array(Math.max(length, 24))
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

function jpeg(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(32)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0)
  const view = new DataView(bytes.buffer)
  view.setUint16(7, height)
  view.setUint16(9, width)
  return bytes.buffer
}

function buildHarness() {
  const events = new InMemoryEventRepository([eventFixture])
  const storage = new InMemoryObjectStorage()
  const service = new EventBrandingService(events, storage, { now: () => FIXED_NOW })
  return { events, storage, service }
}

describe('EventBrandingService', () => {
  it('reads dimensions from both supported image containers', () => {
    expect(inspectBrandingImage('image/png', png(512, 256))).toEqual({ width: 512, height: 256 })
    expect(inspectBrandingImage('image/jpeg', jpeg(1600, 900))).toEqual({
      width: 1600,
      height: 900,
    })
  })

  it('stores event-owned logo and background assets and serves them publicly', async () => {
    const { service, events, storage } = buildHarness()

    const logo = await service.store(organizerActor, eventFixture.slug, 'logo', {
      contentType: 'image/png',
      bytes: png(512, 256),
    })
    const background = await service.store(organizerActor, eventFixture.slug, 'background', {
      contentType: 'image/png',
      bytes: png(1600, 900),
    })

    expect(logo).toMatchObject({ kind: 'logo', width: 512, height: 256 })
    expect(background).toMatchObject({ kind: 'background', width: 1600, height: 900 })
    expect(storage.objects.size).toBe(2)
    expect((await events.findBySlug(eventFixture.slug))?.branding).toMatchObject({
      logo: { width: 512, height: 256 },
      background: { width: 1600, height: 900 },
    })
    expect((await service.getPublic(eventFixture.slug, 'logo'))?.body.byteLength).toBe(64)
  })

  it('rejects malformed, undersized, and oversized images before any write', async () => {
    const { service, events, storage } = buildHarness()

    await expect(
      service.store(organizerActor, eventFixture.slug, 'logo', {
        contentType: 'image/png',
        bytes: png(32, 32),
      }),
    ).rejects.toBeInstanceOf(BrandingImageInvalidError)
    await expect(
      service.store(organizerActor, eventFixture.slug, 'background', {
        contentType: 'image/png',
        bytes: new Uint8Array([1, 2, 3]).buffer,
      }),
    ).rejects.toBeInstanceOf(BrandingImageInvalidError)
    await expect(
      service.store(organizerActor, eventFixture.slug, 'logo', {
        contentType: 'image/png',
        bytes: png(512, 512, BRANDING_LOGO_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/maximum/i)
    await expect(
      service.store(organizerActor, eventFixture.slug, 'background', {
        contentType: 'image/png',
        bytes: png(1600, 900, BRANDING_BACKGROUND_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/maximum/i)

    expect(storage.puts).toBe(0)
    expect((await events.findBySlug(eventFixture.slug))?.branding).toBeUndefined()
  })

  it('retires the old object after replacement and removes the public reference first', async () => {
    const { service, storage } = buildHarness()
    const first = await service.store(organizerActor, eventFixture.slug, 'logo', {
      contentType: 'image/png',
      bytes: png(512, 256),
    })
    await service.store(organizerActor, eventFixture.slug, 'logo', {
      contentType: 'image/png',
      bytes: png(640, 320),
    })
    expect(storage.deletes).toContain(first.storageKey)

    await service.remove(organizerActor, eventFixture.slug, 'logo')
    expect(await service.getPublic(eventFixture.slug, 'logo')).toBeNull()
    expect(storage.objects.size).toBe(0)
  })
})
