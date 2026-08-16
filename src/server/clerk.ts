import type { ServerContext } from './env'

export interface ClerkIdentity {
  readonly userId: string
}

/** A verified third-party identity is not organizer authorization. */
export function isAuthorizedClerkOrganizer(
  identity: ClerkIdentity,
  allowedUserIds: readonly string[],
): boolean {
  return allowedUserIds.length > 0 && allowedUserIds.includes(identity.userId)
}

export interface VerifyClerkTokenOptions {
  readonly publishableKey: string
  readonly secretKey: string
  readonly authorizedParties: readonly string[]
  readonly nowMs: number
  readonly fetchJwks?: typeof fetch
}

interface JwtHeader {
  readonly alg?: unknown
  readonly kid?: unknown
  readonly typ?: unknown
}

interface JwtPayload {
  readonly sub?: unknown
  readonly iss?: unknown
  readonly exp?: unknown
  readonly nbf?: unknown
  readonly azp?: unknown
  readonly sts?: unknown
}

interface JwksKey extends JsonWebKey {
  readonly kid?: string
  readonly alg?: string
}

/** Frontend API host encoded in a Clerk publishable key, or null if malformed. */
export function frontendApiFromPublishableKey(key: string): string | null {
  const match = /^(?:pk_test_|pk_live_)(.+)$/.exec(key)
  if (match === null || match[1] === undefined) return null
  const bytes = base64UrlToBytes(match[1])
  if (bytes === null) return null
  const decoded = new TextDecoder().decode(bytes)
  const host = decoded.endsWith('$') ? decoded.slice(0, -1) : decoded
  return host.includes('.') ? host : null
}

export function readBearerToken(context: ServerContext): string | null {
  const header = context.req.header('authorization')
  if (header === undefined) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  const token = match?.[1]
  return token !== undefined && token.length > 0 ? token : null
}

/**
 * Verifies a Clerk session JWT with the instance JWKS. Returns null on any
 * failure; callers map that to 401 and never echo the token.
 */
export async function verifyClerkSessionToken(
  token: string,
  options: VerifyClerkTokenOptions,
): Promise<ClerkIdentity | null> {
  const parts = token.split('.')
  if (
    parts.length !== 3 ||
    parts[0] === undefined ||
    parts[1] === undefined ||
    parts[2] === undefined
  ) {
    return null
  }
  const header = decodeJwtJson<JwtHeader>(parts[0])
  const payload = decodeJwtJson<JwtPayload>(parts[1])
  if (header === null || payload === null) return null
  if (header.alg !== 'RS256') return null
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
  if (payload.sts === 'pending') return null

  const nowSeconds = Math.floor(options.nowMs / 1000)
  if (typeof payload.exp === 'number' && payload.exp < nowSeconds) return null
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) return null

  const frontendApi = frontendApiFromPublishableKey(options.publishableKey)
  if (frontendApi !== null) {
    if (payload.iss !== `https://${frontendApi}`) return null
  }

  if (typeof payload.azp === 'string' && options.authorizedParties.length > 0) {
    if (!options.authorizedParties.includes(payload.azp)) return null
  }

  const jwksUrl = clerkJwksUrl(options.publishableKey, options.secretKey)
  if (jwksUrl === null) return null
  const keys = await loadJwks(
    jwksUrl,
    options.secretKey,
    options.fetchJwks ?? globalThis.fetch.bind(globalThis),
  )
  if (keys === null) return null
  const jwk = selectJwksKey(keys, typeof header.kid === 'string' ? header.kid : undefined)
  if (jwk === null) return null

  const verified = await verifyRs256(`${parts[0]}.${parts[1]}`, parts[2], jwk)
  if (!verified) return null
  return { userId: payload.sub }
}

function clerkJwksUrl(publishableKey: string, secretKey: string): string | null {
  const frontendApi = frontendApiFromPublishableKey(publishableKey)
  if (frontendApi !== null) {
    return `https://${frontendApi}/.well-known/jwks.json`
  }
  if (secretKey.length > 0) return 'https://api.clerk.com/v1/jwks'
  return null
}

async function loadJwks(
  url: string,
  secretKey: string,
  fetchImpl: typeof fetch,
): Promise<readonly JwksKey[] | null> {
  try {
    const headers: Record<string, string> = {}
    if (url.startsWith('https://api.clerk.com/') && secretKey.length > 0) {
      headers.authorization = `Bearer ${secretKey}`
    }
    const response = await fetchImpl(url, { headers })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return null
    const keys = (body as { keys?: unknown }).keys
    if (!Array.isArray(keys)) return null
    return keys.filter((key): key is JwksKey => typeof key === 'object' && key !== null)
  } catch {
    return null
  }
}

function selectJwksKey(keys: readonly JwksKey[], kid: string | undefined): JwksKey | null {
  if (kid !== undefined) {
    return keys.find((key) => key.kid === kid) ?? null
  }
  return keys.length === 1 ? (keys[0] ?? null) : null
}

async function verifyRs256(signed: string, signature: string, jwk: JwksKey): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const data = new TextEncoder().encode(signed)
    const sig = base64UrlToBytes(signature)
    if (sig === null) return false
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)
  } catch {
    return false
  }
}

function decodeJwtJson<T>(part: string): T | null {
  const bytes = base64UrlToBytes(part)
  if (bytes === null) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return typeof parsed === 'object' && parsed !== null ? (parsed as T) : null
  } catch {
    return null
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
    const binary = atob(padded + pad)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}
