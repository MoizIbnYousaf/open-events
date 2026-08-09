import type { UtcInstant } from './event.ts'

export type ContactId = string

export const CONTACT_ROLES = ['primary', 'co-speaker'] as const

export type ContactRole = (typeof CONTACT_ROLES)[number]

/**
 * Maximum number of co-speakers allowed on one submission.
 *
 * Each co-speaker costs two D1 statements in the submit batch (contact upsert
 * + contributor insert), so the cap keeps a single submit comfortably below
 * the 50-query free-tier invocation ceiling; it also covers realistic
 * conference proposals.
 */
export const MAX_CO_SPEAKERS = 10

/** Deduplicated speaker identity; `email` is always the normalized form. */
export interface Contact {
  readonly id: ContactId
  readonly email: string
  readonly name: string
  readonly createdAt: UtcInstant
}
