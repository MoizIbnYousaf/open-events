import type { Event, EventBranding, EventBrandingAsset, EventBrandingKind } from '../../domain'
import { assertActorCanMutate, type OrganizerActor } from '../actors'
import { ApplicationError } from '../errors'
import { publicEventBrandingPath } from '../public-path'
import type { Clock } from '../ports/clock'
import type { EventConfigRepository } from '../ports/event-config-repository'
import type { ObjectStoragePort, StoredObject } from '../ports/object-storage'

export const BRANDING_LOGO_MAX_BYTES = 1024 * 1024
export const BRANDING_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024
export const BRANDING_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const

type BrandingContentType = (typeof BRANDING_CONTENT_TYPES)[number]

export class BrandingImageTooLargeError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Branding image exceeds the maximum upload size')
    this.name = 'BrandingImageTooLargeError'
  }
}

export class BrandingImageUnsupportedTypeError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Branding image type is not supported')
    this.name = 'BrandingImageUnsupportedTypeError'
  }
}

export class BrandingImageInvalidError extends ApplicationError {
  constructor() {
    super('validation_failed', 'Branding image is malformed or has invalid dimensions')
    this.name = 'BrandingImageInvalidError'
  }
}

export interface BrandingImageInput {
  readonly contentType: string
  readonly bytes: ArrayBuffer
}

export interface BrandingAssetDto extends EventBrandingAsset {
  readonly kind: EventBrandingKind
  readonly url: string
}

export interface PublicBrandingAsset extends StoredObject {
  readonly width: number
  readonly height: number
}

function isBrandingContentType(value: string): value is BrandingContentType {
  return BRANDING_CONTENT_TYPES.some((allowed) => allowed === value)
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  while (offset + 8 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= bytes.byteLength) return null
    const length = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0)
    if (length < 2 || offset + length > bytes.byteLength) return null
    if (startOfFrameMarkers.has(marker)) {
      const height = (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0)
      const width = (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0)
      return { width, height }
    }
    offset += length
  }
  return null
}

export function inspectBrandingImage(
  contentType: string,
  body: ArrayBuffer,
): { width: number; height: number } | null {
  const bytes = new Uint8Array(body)
  if (contentType === 'image/png') return pngDimensions(bytes)
  if (contentType === 'image/jpeg') return jpegDimensions(bytes)
  return null
}

function validDimensions(kind: EventBrandingKind, width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false
  if (kind === 'logo') return width >= 64 && height >= 64 && width <= 2048 && height <= 2048
  return width >= 800 && height >= 400 && width <= 6000 && height <= 4000
}

function brandingOf(event: Event): EventBranding {
  return event.branding ?? { logo: null, background: null }
}

export class EventBrandingService {
  readonly #events: EventConfigRepository
  readonly #storage: ObjectStoragePort
  readonly #clock: Clock

  constructor(events: EventConfigRepository, storage: ObjectStoragePort, clock: Clock) {
    this.#events = events
    this.#storage = storage
    this.#clock = clock
  }

  async store(
    _actor: OrganizerActor,
    slug: string,
    kind: EventBrandingKind,
    input: BrandingImageInput,
  ): Promise<BrandingAssetDto> {
    assertActorCanMutate(_actor)
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', 'Event not found')
    if (!isBrandingContentType(input.contentType)) {
      throw new BrandingImageUnsupportedTypeError()
    }
    const maxBytes = kind === 'logo' ? BRANDING_LOGO_MAX_BYTES : BRANDING_BACKGROUND_MAX_BYTES
    if (input.bytes.byteLength > maxBytes) throw new BrandingImageTooLargeError()
    const dimensions = inspectBrandingImage(input.contentType, input.bytes)
    if (dimensions === null || !validDimensions(kind, dimensions.width, dimensions.height)) {
      throw new BrandingImageInvalidError()
    }
    const id = crypto.randomUUID()
    const storageKey = `events/${event.id}/branding/${kind}/${id}`
    const asset: EventBrandingAsset = {
      storageKey,
      contentType: input.contentType,
      width: dimensions.width,
      height: dimensions.height,
      updatedAt: this.#clock.now(),
    }
    const currentBranding = brandingOf(event)
    const previous = currentBranding[kind]
    const branding: EventBranding = { ...currentBranding, [kind]: asset }
    await this.#storage.put(storageKey, input.bytes, input.contentType)
    try {
      await this.#events.save({ ...event, branding })
    } catch (error) {
      await this.#storage.delete(storageKey)
      throw error
    }
    if (previous !== null) await this.#storage.delete(previous.storageKey)
    return { ...asset, kind, url: publicEventBrandingPath(event.slug, kind, asset.updatedAt) }
  }

  async remove(_actor: OrganizerActor, slug: string, kind: EventBrandingKind): Promise<void> {
    assertActorCanMutate(_actor)
    const event = await this.#events.findBySlug(slug)
    if (event === null) throw new ApplicationError('not_found', 'Event not found')
    const currentBranding = brandingOf(event)
    const previous = currentBranding[kind]
    if (previous === null) return
    await this.#events.save({ ...event, branding: { ...currentBranding, [kind]: null } })
    await this.#storage.delete(previous.storageKey)
  }

  async getPublic(slug: string, kind: EventBrandingKind): Promise<PublicBrandingAsset | null> {
    const event = await this.#events.findBySlug(slug)
    const asset = event === null ? null : brandingOf(event)[kind]
    if (asset === null) return null
    const stored = await this.#storage.get(asset.storageKey)
    return stored === null ? null : { ...stored, width: asset.width, height: asset.height }
  }
}
