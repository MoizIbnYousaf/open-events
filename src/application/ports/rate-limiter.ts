/** Cloudflare-compatible edge limiter result. */
export interface EdgeRateLimitResult {
  readonly success: boolean
}

/**
 * Narrow port around a Workers Rate Limiting binding. The product's durable
 * limits live in D1; this port is only the cheap, location-local burst shield.
 */
export interface EdgeRateLimiter {
  limit(input: { readonly key: string }): Promise<EdgeRateLimitResult>
}
