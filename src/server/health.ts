import type { D1Database } from '@cloudflare/workers-types'

import type { ServerContext } from './env'
import { getDatabaseBinding } from './env'

/** Safe health payload; reports build identity and database reachability only. */
export interface HealthPayload {
  readonly status: 'ok'
  readonly build: 'm1'
  readonly database: {
    readonly status: 'ok' | 'unavailable'
  }
}

/** Performs a real D1 read to prove the database binding is usable. */
export async function probeDatabase(db: D1Database): Promise<boolean> {
  try {
    const result = await db.prepare('SELECT 1').run()
    return result.success
  } catch {
    return false
  }
}

/** GET /api/health handler. */
export async function handleHealth(context: ServerContext): Promise<Response> {
  const db = getDatabaseBinding(context)
  const status = db !== null && (await probeDatabase(db)) ? 'ok' : 'unavailable'
  const payload: HealthPayload = { status: 'ok', build: 'm1', database: { status } }
  return context.json(payload)
}
