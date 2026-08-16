/** Bytes plus the content type they were stored with. */
export interface StoredObject {
  readonly body: ArrayBuffer
  readonly contentType: string
}

export interface StoredObjectPage {
  readonly keys: readonly string[]
  readonly cursor: string | null
}

/**
 * Object storage the application owns in terms of opaque keys only. The R2
 * adapter lives in `src/server`; the in-memory adapter lives in the test
 * helpers. Keys are always derived by the application from actor-scoped
 * values, never taken from a request.
 */
export interface ObjectStoragePort {
  put(storageKey: string, body: ArrayBuffer, contentType: string): Promise<void>
  get(storageKey: string): Promise<StoredObject | null>
  delete(storageKey: string): Promise<void>
  /** One bounded page under an application-owned prefix. */
  listPrefix(prefix: string, cursor?: string): Promise<StoredObjectPage>
}
