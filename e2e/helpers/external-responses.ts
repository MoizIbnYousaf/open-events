const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

/**
 * Cloudflare's stable Turnstile loader redirects to its current versioned
 * bundle. Keep this exception exact so other third-party redirects remain
 * visible in the live evidence ledger.
 */
export function isExpectedTurnstileLoaderRedirect(
  method: string,
  rawUrl: string,
  status: number,
): boolean {
  if (method !== 'GET' || status !== 302) return false
  const url = new URL(rawUrl)
  return (
    url.origin === TURNSTILE_ORIGIN &&
    url.pathname === '/turnstile/v0/api.js' &&
    url.search === '?render=explicit'
  )
}
