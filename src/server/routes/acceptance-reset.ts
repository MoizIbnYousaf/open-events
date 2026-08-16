import type { Hono } from 'hono'

import { resetAcceptanceEvent } from '../../db/acceptance-reset-repository'
import type { ObjectStoragePort } from '../../application/ports/object-storage'
import { createR2ObjectStorage } from '../storage'
import type { ServerContext, ServerEnv } from '../env'
import {
  databaseUnavailableResponse,
  getDatabaseBinding,
  getFilesBinding,
  storageUnavailableResponse,
} from '../env'
import { forbiddenResponse, notFoundResponse, validationFailedResponse } from '../error'

const MAX_RESET_BODY_BYTES = 4 * 1024
const MAX_EVENT_OBJECTS = 10_000
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ResetRequest {
  readonly expectedEnvironment: string
  readonly expectedBuildRevision: string
  readonly expectedEventId: string
  readonly expectedD1Id: string
  readonly expectedR2Bucket: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseResetRequest(value: unknown): ResetRequest | null {
  if (!isRecord(value)) return null
  const keys = [
    'expectedEnvironment',
    'expectedBuildRevision',
    'expectedEventId',
    'expectedD1Id',
    'expectedR2Bucket',
  ] as const
  if (keys.some((key) => typeof value[key] !== 'string' || value[key].length === 0)) return null
  const parsed = value as unknown as ResetRequest
  return EVENT_ID.test(parsed.expectedEventId) ? parsed : null
}

async function readResetRequest(context: ServerContext): Promise<ResetRequest | null> {
  const media = (context.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  if (media !== 'application/json') return null
  const declared = Number(context.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_RESET_BODY_BYTES) return null
  const reader = context.req.raw.body?.getReader()
  if (reader === undefined) return null
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESET_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return parseResetRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    return null
  }
}

async function secretsEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const lhs = new Uint8Array(a)
  const rhs = new Uint8Array(b)
  let difference = 0
  for (let index = 0; index < lhs.length; index += 1) {
    difference |= (lhs[index] ?? 0) ^ (rhs[index] ?? 0)
  }
  return difference === 0
}

export async function deleteAcceptanceEventObjects(
  storage: ObjectStoragePort,
  eventId: string,
): Promise<string[]> {
  if (!EVENT_ID.test(eventId)) throw new Error('unsafe_event_id')
  const prefix = `events/${eventId}/`
  const keys: string[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await storage.listPrefix(prefix, cursor)
    if (page.keys.some((key) => !key.startsWith(prefix))) throw new Error('unsafe_object_prefix')
    keys.push(...page.keys)
    if (keys.length > MAX_EVENT_OBJECTS) throw new Error('object_limit_exceeded')
    if (page.cursor === null) break
    if (page.cursor === cursor) throw new Error('object_cursor_stalled')
    cursor = page.cursor
  }
  for (const key of keys) await storage.delete(key)
  return keys
}

/** Release-operator-only destructive reset. Production is indistinguishable from no route. */
export async function handleAcceptanceReset(context: ServerContext): Promise<Response> {
  if (context.env.DEPLOY_ENVIRONMENT !== 'acceptance') return notFoundResponse(context)
  const expectedSecret = context.env.ACCEPTANCE_RESET_SECRET ?? ''
  const supplied = (context.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (expectedSecret.length < 32 || supplied.length === 0) return forbiddenResponse(context)
  if (!(await secretsEqual(expectedSecret, supplied))) return forbiddenResponse(context)
  const request = await readResetRequest(context)
  if (request === null) return validationFailedResponse(context)

  const buildRevision = context.env.BUILD_REVISION ?? ''
  const d1Id = context.env.RESOURCE_D1_ID ?? ''
  const r2Bucket = context.env.RESOURCE_R2_NAME ?? ''
  if (
    request.expectedEnvironment !== 'acceptance' ||
    request.expectedBuildRevision !== buildRevision ||
    request.expectedD1Id !== d1Id ||
    request.expectedR2Bucket !== r2Bucket ||
    buildRevision.length === 0 ||
    d1Id.length === 0 ||
    r2Bucket.length === 0
  ) {
    return forbiddenResponse(context)
  }

  const db = getDatabaseBinding(context)
  if (db === null) return databaseUnavailableResponse(context)
  if (getFilesBinding(context) === null) return storageUnavailableResponse(context)
  const storage = createR2ObjectStorage(context.env.FILES)
  const keys = await deleteAcceptanceEventObjects(storage, request.expectedEventId)

  const receipt = await resetAcceptanceEvent(db, {
    auditId: crypto.randomUUID(),
    eventId: request.expectedEventId,
    objectCount: keys.length,
    createdAt: new Date().toISOString(),
    buildRevision,
    d1Id,
    r2Bucket,
  })
  context.header('Cache-Control', 'no-store')
  return context.json({ reset: true, ...receipt })
}

export function registerAcceptanceResetRoutes(app: Hono<ServerEnv>): void {
  app.post('/api/acceptance/reset', handleAcceptanceReset)
}
