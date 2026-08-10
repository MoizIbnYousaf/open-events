import type { MiddlewareHandler } from 'hono'

import type { ServerEnv } from './env'
import { getAllowedOrigins } from './env'
import { forbiddenResponse } from './error'

function originFromUrl(raw: string): string | null {
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

/**
 * Origin/Referer allowlist gate for cookie-authenticated mutations. The
 * `Origin` header is authoritative; `Referer` is used only when `Origin` is
 * absent. Fails closed (403) on any missing/mismatched/malformed value or
 * when the allowlist is empty.
 */
export function csrfGate(): MiddlewareHandler<ServerEnv> {
  return async (context, next) => {
    const allowed = new Set<string>()
    for (const entry of getAllowedOrigins(context)) {
      const origin = originFromUrl(entry)
      if (origin !== null) allowed.add(origin)
    }
    if (allowed.size === 0) {
      return forbiddenResponse(context)
    }

    const originHeader = context.req.header('origin')
    let candidate: string | null = null
    if (originHeader !== undefined && originHeader.trim().length > 0) {
      candidate = originFromUrl(originHeader.trim())
    } else {
      const referer = context.req.header('referer')
      if (referer !== undefined && referer.trim().length > 0) {
        candidate = originFromUrl(referer.trim())
      }
    }

    if (candidate === null || !allowed.has(candidate)) {
      return forbiddenResponse(context)
    }
    return next()
  }
}
