import type { ObjectStoragePort, StoredObject } from '../application'

/**
 * R2 adapter for the application `ObjectStoragePort`. Keys are opaque here;
 * they are always derived by the application from the session actor, never
 * from request input.
 */
export function createR2ObjectStorage(bucket: R2Bucket): ObjectStoragePort {
  return {
    async put(storageKey, body, contentType) {
      await bucket.put(storageKey, body, { httpMetadata: { contentType } })
    },
    async get(storageKey): Promise<StoredObject | null> {
      const object = await bucket.get(storageKey)
      if (object === null) return null
      return {
        body: await object.arrayBuffer(),
        contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      }
    },
    async delete(storageKey) {
      await bucket.delete(storageKey)
    },
    async listPrefix(prefix, cursor) {
      const page = await bucket.list({ prefix, cursor, limit: 1_000 })
      return {
        keys: page.objects.map((object) => object.key),
        cursor: page.truncated ? page.cursor : null,
      }
    },
  }
}
