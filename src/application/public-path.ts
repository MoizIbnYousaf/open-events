import type { EventSlug, FormSlug } from '../domain'

/**
 * Canonical clean public CFP path: `/cfp/:eventSlug/:formSlug`. The start
 * flow's captured link and the token-redemption redirect both target this
 * exact two-segment path; the API equivalent is
 * `GET /api/public/cfp/:eventSlug/:formSlug`.
 */
export function publicCfpPath(eventSlug: EventSlug, formSlug: FormSlug): string {
  return `/cfp/${encodeURIComponent(eventSlug)}/${encodeURIComponent(formSlug)}`
}
