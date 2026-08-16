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

/**
 * Canonical speaker portal path. It is the ONLY surface that carries the
 * onboarding checklist, the headshot upload and the calendar-invite download,
 * so the acceptance message and every public page address it by this literal.
 */
export const SPEAKER_PORTAL_PATH = '/portal'
