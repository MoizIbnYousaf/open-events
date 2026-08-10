import { describe, expect, it } from 'vitest'

import {
  HEADSHOT_CONTENT_TYPES,
  HEADSHOT_MAX_BYTES,
  HeadshotEmptyError,
  HeadshotService,
  HeadshotTooLargeError,
  HeadshotUnsupportedTypeError,
  type StoreHeadshotInput,
} from '../../../src/application'
import { FIXED_NOW, foreignActor, ownerActor } from '../helpers/fixtures'
import {
  InMemoryObjectStorage,
  InMemoryUploadedFileRepository,
} from '../helpers/in-memory-repositories'

function bytes(length: number): ArrayBuffer {
  return new Uint8Array(length).fill(7).buffer
}

function buildHarness(clockNow = FIXED_NOW) {
  const files = new InMemoryUploadedFileRepository()
  const storage = new InMemoryObjectStorage()
  const service = new HeadshotService(files, storage, { now: () => clockNow })
  return { service, files, storage }
}

function input(overrides: Partial<StoreHeadshotInput> = {}): StoreHeadshotInput {
  return { contentType: 'image/png', bytes: bytes(64), ...overrides }
}

describe('HeadshotService.storeHeadshot', () => {
  it('stores the upload and serves it back to the owner', async () => {
    const { service, storage } = buildHarness()

    const stored = await service.storeHeadshot(ownerActor, input())

    expect(stored.contentType).toBe('image/png')
    expect(stored.sizeBytes).toBe(64)
    expect(stored.updatedAt).toBe(FIXED_NOW)
    expect(storage.objects.size).toBe(1)

    const fetched = await service.getOwnHeadshot(ownerActor)
    expect(fetched).not.toBeNull()
    expect(fetched?.contentType).toBe('image/png')
    expect(fetched?.sizeBytes).toBe(64)
    expect(new Uint8Array(fetched?.body ?? new ArrayBuffer(0))).toHaveLength(64)
  })

  it('denies an oversize upload with zero storage and zero metadata writes', async () => {
    const { service, files, storage } = buildHarness()

    await expect(
      service.storeHeadshot(ownerActor, input({ bytes: bytes(HEADSHOT_MAX_BYTES + 1) })),
    ).rejects.toBeInstanceOf(HeadshotTooLargeError)

    expect(storage.puts).toBe(0)
    expect(storage.objects.size).toBe(0)
    expect(files.list()).toHaveLength(0)
  })

  it('denies an empty body as empty — not as oversize — with zero writes', async () => {
    const { service, files, storage } = buildHarness()

    const thrown: unknown = await service
      .storeHeadshot(ownerActor, input({ bytes: bytes(0) }))
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(HeadshotEmptyError)
    expect(thrown).not.toBeInstanceOf(HeadshotTooLargeError)
    expect(storage.puts).toBe(0)
    expect(storage.objects.size).toBe(0)
    expect(files.list()).toHaveLength(0)
  })

  it('accepts the largest body inside the frozen budget', async () => {
    const { service } = buildHarness()

    const stored = await service.storeHeadshot(
      ownerActor,
      input({ bytes: bytes(HEADSHOT_MAX_BYTES) }),
    )

    expect(stored.sizeBytes).toBe(HEADSHOT_MAX_BYTES)
  })

  it('denies an unsupported content type with zero storage and zero metadata writes', async () => {
    const { service, files, storage } = buildHarness()

    await expect(
      service.storeHeadshot(ownerActor, input({ contentType: 'application/pdf' })),
    ).rejects.toBeInstanceOf(HeadshotUnsupportedTypeError)

    expect(storage.puts).toBe(0)
    expect(files.list()).toHaveLength(0)
    expect(HEADSHOT_CONTENT_TYPES).not.toContain('application/pdf')
  })

  it('never exposes another owner headshot (cross-owner reads resolve to null)', async () => {
    const { service } = buildHarness()

    await service.storeHeadshot(ownerActor, input())

    expect(await service.getOwnHeadshot(foreignActor)).toBeNull()
  })

  it('keeps exactly one metadata row and one object after a replacement', async () => {
    const { service, files, storage } = buildHarness()

    const first = await service.storeHeadshot(ownerActor, input())
    const second = await service.storeHeadshot(
      ownerActor,
      input({ contentType: 'image/jpeg', bytes: bytes(128) }),
    )

    expect(files.list()).toHaveLength(1)
    expect(storage.objects.size).toBe(1)
    expect(second.id).not.toBe(first.id)
    const current = await service.getOwnHeadshot(ownerActor)
    expect(current?.contentType).toBe('image/jpeg')
    expect(current?.sizeBytes).toBe(128)
  })

  it('deletes the stored object when the metadata write fails (no orphan objects)', async () => {
    const { service, files, storage } = buildHarness()
    files.failNextUpsert()

    await expect(service.storeHeadshot(ownerActor, input())).rejects.toThrow()

    expect(storage.puts).toBe(1)
    expect(storage.deletes).toHaveLength(1)
    expect(storage.objects.size).toBe(0)
    expect(files.list()).toHaveLength(0)
    expect(await service.getOwnHeadshot(ownerActor)).toBeNull()
  })

  it('returns null when metadata exists but the object is missing', async () => {
    const { service, storage } = buildHarness()

    await service.storeHeadshot(ownerActor, input())
    storage.objects.clear()

    expect(await service.getOwnHeadshot(ownerActor)).toBeNull()
  })
})
