import type { ServerDeps } from './container'
import { getTtlConfig, type ServerContext } from './env'

/**
 * Mints a real magic-link for a reviewer the organizer just seated or assigned.
 *
 * Assigning by email used to create the contact and then stop. The captured
 * inbox for that address stayed empty, so an isolated reviewer context had no
 * way to sign in. This is the same start-token path a speaker uses; redeem
 * already sends a seated committee member to `/evaluations`.
 */
export async function sendReviewerInvite(
  context: ServerContext,
  deps: ServerDeps,
  slug: string,
  email: string,
): Promise<{ readonly invitePath: string | null; readonly inviteSent: boolean }> {
  const event = await deps.events.findBySlug(slug)
  if (event === null) return { invitePath: null, inviteSent: false }
  const forms = await deps.forms.listByEvent(event.id)
  const form = forms.find((item) => item.publishedVersionId !== null) ?? forms[0]
  if (form === undefined) return { invitePath: null, inviteSent: false }
  const ttlMs = getTtlConfig(context).submitterTokenMs
  await deps.session.startSubmitter({ email, eventSlug: slug, formSlug: form.slug }, ttlMs, (token) => {
    return `/api/public/session?token=${encodeURIComponent(token)}`
  })
  const messages = await deps.capturedMessages.listByEmail(email)
  const body = messages.at(-1)?.body ?? ''
  const match = body.match(/\/api\/public\/session\?token=[^\s]+/)
  return { invitePath: match?.[0] ?? null, inviteSent: true }
}
