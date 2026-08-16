export const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
export const TURNSTILE_ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA'
export const TURNSTILE_PUBLIC_START_ACTION = 'public_start'
const TURNSTILE_ACCEPTANCE_HOST = 'open-events-acceptance.speakerops.workers.dev'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const MAX_TOKEN_LENGTH = 2048

interface SiteverifyResponse {
  readonly success?: unknown
  readonly hostname?: unknown
  readonly action?: unknown
}

export interface VerifyTurnstileOptions {
  readonly token: string
  readonly secret: string
  readonly remoteAddress?: string
  readonly expectedAction: string
  readonly expectedHostnames: readonly string[]
  readonly fetchSiteverify?: typeof fetch
}

/**
 * Mandatory Siteverify check. Failures intentionally collapse to false; the
 * public route then returns its ordinary enumeration-safe accepted response.
 */
export async function verifyTurnstile(options: VerifyTurnstileOptions): Promise<boolean> {
  if (
    options.token.length > MAX_TOKEN_LENGTH ||
    options.secret.length === 0 ||
    options.expectedHostnames.length === 0
  ) {
    return false
  }

  // Cloudflare's documented deterministic test pair. It is valid only for
  // local development and the isolated acceptance Worker. Production hosts
  // can never use this branch, even if the test secret is misconfigured.
  if (options.secret === TURNSTILE_ALWAYS_PASS_SECRET) {
    const testHostOnly = options.expectedHostnames.every(
      (hostname) =>
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === TURNSTILE_ACCEPTANCE_HOST,
    )
    return (
      testHostOnly &&
      (options.token === TURNSTILE_DUMMY_TOKEN || options.token.length === 0) &&
      options.expectedAction === TURNSTILE_PUBLIC_START_ACTION
    )
  }

  if (options.token.length === 0) return false

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const body = new URLSearchParams({
      secret: options.secret,
      response: options.token,
      idempotency_key: crypto.randomUUID(),
    })
    if (options.remoteAddress !== undefined) body.set('remoteip', options.remoteAddress)
    const response = await (options.fetchSiteverify ?? globalThis.fetch.bind(globalThis))(
      SITEVERIFY_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      },
    )
    if (!response.ok) return false
    const result = (await response.json()) as SiteverifyResponse
    return (
      result.success === true &&
      result.action === options.expectedAction &&
      typeof result.hostname === 'string' &&
      options.expectedHostnames.includes(result.hostname)
    )
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
