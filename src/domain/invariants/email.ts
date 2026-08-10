/** Canonical form of an identity email: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Basic structural check for an email address (no external validation). */
export function isValidEmailAddress(email: string): boolean {
  const normalized = normalizeEmail(email)
  const atIndex = normalized.indexOf('@')
  if (atIndex <= 0 || atIndex >= normalized.length - 1) return false
  if (normalized.includes(' ')) return false
  const domain = normalized.slice(atIndex + 1)
  return !domain.includes('@')
}

/** True when the email is already in canonical form and structurally valid. */
export function isNormalizedEmail(email: string): boolean {
  return email === normalizeEmail(email) && isValidEmailAddress(email)
}
