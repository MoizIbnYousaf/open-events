/** True when a value is a Clerk publishable key (`pk_test_` / `pk_live_`). */
export function isClerkPublishableKey(value: string | undefined): boolean {
  return typeof value === 'string' && /^pk_(test|live)_/.test(value)
}

/**
 * The Vite-exposed Clerk publishable key, or undefined when Clerk is not
 * configured. Unit tests force this empty so the judged surfaces stay free of
 * the Clerk chunk.
 */
export function clerkPublishableKey(): string | undefined {
  const value = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  return isClerkPublishableKey(value) ? value : undefined
}

/** Organizer OAuth is optional; speaker magic links never depend on this. */
export function isClerkConfigured(): boolean {
  return clerkPublishableKey() !== undefined
}
