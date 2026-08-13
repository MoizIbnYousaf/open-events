import type { EmailSender, OutboundEmail } from '../application/ports/email-sender'

/**
 * The default: record only, deliver nothing.
 *
 * What development and every test run use, and what a deployment falls back to
 * when no provider is configured. A product that silently mails real people the
 * moment someone runs the test suite is a product nobody can safely develop.
 */
export const capturingEmailSender: EmailSender = {
  async send() {
    // Deliberately nothing. The message is already in the captured-message log,
    // which is the record; this adapter simply does not deliver it.
  },
}

/** Configuration a provider-backed sender needs before it can deliver anything. */
export interface ResendConfig {
  readonly apiKey: string
  /** The From address. Must be on a domain verified with the provider. */
  readonly from: string
}

/**
 * Delivery through Resend's HTTP API.
 *
 * Chosen because it is a single authenticated POST with no SDK, which is what a
 * Worker wants: no Node built-ins, no connection pooling, nothing to keep warm.
 *
 * Failures are swallowed by design — see `EmailSender`. A speaker who submitted
 * a proposal has submitted it whether or not the confirmation left the
 * building, and the captured-message log already records what we meant to send,
 * so a failed delivery is recoverable by reading that log rather than by
 * failing the request that caused it.
 */
export function createResendEmailSender(config: ResendConfig): EmailSender {
  return {
    async send(email: OutboundEmail): Promise<void> {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            from: config.from,
            to: [email.to],
            subject: email.subject,
            text: email.body,
          }),
        })
        if (!response.ok) {
          // Named on the console rather than thrown: the operator needs to know
          // delivery is failing, and the caller must not care.
          console.warn(`email delivery refused with ${response.status} for ${email.to}`)
        }
      } catch (error) {
        console.warn('email delivery failed', error)
      }
    },
  }
}

/**
 * The sender a deployment gets, decided by what it was configured with.
 *
 * Absent credentials mean capture-only, so the safe behaviour is the DEFAULT
 * rather than something an operator has to remember to ask for. Turning real
 * delivery on is the deliberate act.
 */
export function selectEmailSender(env: {
  readonly RESEND_API_KEY?: string
  readonly EMAIL_FROM?: string
}): EmailSender {
  const apiKey = env.RESEND_API_KEY
  const from = env.EMAIL_FROM
  if (typeof apiKey !== 'string' || apiKey === '') return capturingEmailSender
  if (typeof from !== 'string' || from === '') {
    // A key with no From address cannot send: refusing here, loudly, beats
    // discovering it one rejected message at a time.
    console.warn('RESEND_API_KEY is set without EMAIL_FROM; falling back to capture-only')
    return capturingEmailSender
  }
  return createResendEmailSender({ apiKey, from })
}
