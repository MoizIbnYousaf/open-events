import type { ServerDeps } from './container'
import type { OrganizerActor } from '../application'
import { normalizeEmail } from '../domain/invariants/email'
import { ConfigError, type ServerContext } from './env'
import { startMailBudgetReservation } from './rate-limit'

/**
 * Mints a real magic-link for a reviewer the organizer just seated or assigned.
 *
 * Assigning by email used to create the contact and then stop. The captured
 * inbox for that address stayed empty, so an isolated reviewer context had no
 * way to sign in. This explicitly issues an evaluation-purpose token; redeem
 * follows that persisted purpose and never infers authority from contact roles.
 */
export async function sendReviewerInvite(
  context: ServerContext,
  deps: ServerDeps,
  actor: OrganizerActor,
  eventId: string,
  contactId: string,
  email: string,
): Promise<{ readonly invitePath: string | null; readonly inviteSent: boolean }> {
  const budget = await startMailBudgetReservation(context, normalizeEmail(email), deps.clock.now())
  if (budget === null) throw new ConfigError('Missing mail budget configuration')
  const result = await deps.session.issueRoleAccess(actor, {
    eventId,
    contactId,
    email,
    purpose: 'evaluation',
    subject: 'Your Open Events reviewer invitation',
    renderBody: (accessUrl) => `Open your private evaluation queue: ${accessUrl}`,
    kind: 'confirmation',
    submissionId: null,
    proof: { kind: 'committee-member' },
    budget,
  })
  if (result.outcome === 'limited') return { invitePath: null, inviteSent: false }
  return { invitePath: result.accessUrl, inviteSent: true }
}
