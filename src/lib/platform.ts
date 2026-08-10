/**
 * Which modifier glyphs to print in a keyboard hint.
 *
 * Client-only SPA, so this can be read during render with no hydration risk.
 * Kept out of the components that use it because two of them print hints for
 * two different chords and must agree on the platform.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad/.test(navigator.userAgent)
}
