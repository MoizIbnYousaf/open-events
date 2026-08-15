import { SUPPORT_GUEST_COOKIE } from '../domain/support'
import type { ServerContext } from './env'

/** Reads the Orby guest resume token. Duplicate or empty cookies fail closed. */
export function readSupportGuestToken(context: ServerContext): string | null {
  const header = context.req.header('cookie')
  if (header === undefined) return null
  const values: string[] = []
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const name = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (name === SUPPORT_GUEST_COOKIE) {
      if (value.length === 0) return null
      values.push(value)
    }
  }
  if (values.length !== 1) return null
  return values[0] ?? null
}

export function serializeSupportGuestCookie(token: string, secure: boolean): string {
  let cookie = `${SUPPORT_GUEST_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`
  if (secure) cookie += '; Secure'
  return cookie
}
