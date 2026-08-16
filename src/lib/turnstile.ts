export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'

export type TurnstileClientConfiguration =
  | { readonly state: 'ready'; readonly siteKey: string; readonly required: true }
  | { readonly state: 'local-bypass'; readonly siteKey: undefined; readonly required: false }
  | { readonly state: 'unavailable'; readonly siteKey: undefined; readonly required: true }

export function isTurnstileSiteKey(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9A-Za-z_-]{20,}$/.test(value)
}

export function resolveTurnstileClientConfiguration(
  configured: string | undefined,
  development: boolean,
): TurnstileClientConfiguration {
  if (isTurnstileSiteKey(configured)) return { state: 'ready', siteKey: configured, required: true }
  if (!development) return { state: 'unavailable', siteKey: undefined, required: true }
  if (configured === '') return { state: 'local-bypass', siteKey: undefined, required: false }
  return { state: 'ready', siteKey: TURNSTILE_TEST_SITE_KEY, required: true }
}

/** Production is visibly unavailable without a build-time site key. */
export function turnstileClientConfiguration(): TurnstileClientConfiguration {
  return resolveTurnstileClientConfiguration(
    import.meta.env.VITE_TURNSTILE_SITE_KEY,
    import.meta.env.DEV,
  )
}

export function turnstileSiteKey(): string | undefined {
  return turnstileClientConfiguration().siteKey
}
