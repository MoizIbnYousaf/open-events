import { Resend } from 'resend'

import type { EmailSender } from '../application/ports/email-sender'

/**
 * The default: record only, deliver nothing.
 *
 * What development and every test run use, and what a deployment falls back to
 * when no provider is configured. A product that silently mails real people the
 * moment someone runs the test suite is a product nobody can safely develop.
 */
export const capturingEmailSender: EmailSender = {
  async send() {
    return { outcome: 'captured' }
  },
}

const RESEND_TEST_RECIPIENTS = new Set([
  'delivered@resend.dev',
  'bounced@resend.dev',
  'complained@resend.dev',
  'suppressed@resend.dev',
])

function retryAfterSeconds(headers: Record<string, string> | null): number | undefined {
  const raw = headers?.['retry-after']
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined
  const seconds = Number(raw)
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined
}

export function createResendEmailSender(config: {
  readonly apiKey: string
  readonly from: string
}): EmailSender {
  const resend = new Resend(config.apiKey, { userAgent: 'open-events/1.0 resend-node/6.17.2' })
  return {
    async send(email) {
      if (email.mode === 'resend-test' && !RESEND_TEST_RECIPIENTS.has(email.to)) {
        return { outcome: 'operator_action', code: 'test_recipient_denied' }
      }
      try {
        const result = await resend.emails.send(
          {
            from: config.from,
            to: [email.to],
            subject: email.subject,
            text: email.body,
            tags: [{ name: 'open_events_job', value: email.jobId }],
          },
          { idempotencyKey: email.jobId },
        )
        if (result.error === null) {
          return { outcome: 'accepted', providerId: result.data.id }
        }
        const status = result.error.statusCode
        const code = result.error.name
        if (status === null) return { outcome: 'ambiguous', code }
        if (
          status === 429 ||
          status >= 500 ||
          code === 'concurrent_idempotent_requests' ||
          code === 'rate_limit_exceeded'
        ) {
          const retryAfter = retryAfterSeconds(result.headers)
          return retryAfter === undefined
            ? { outcome: 'retry', code }
            : { outcome: 'retry', code, retryAfterSeconds: retryAfter }
        }
        return { outcome: 'operator_action', code }
      } catch {
        return { outcome: 'ambiguous', code: 'network_error' }
      }
    },
  }
}

/** Selects the explicit adapter. Provider configuration is all-or-nothing. */
export function selectEmailSender(env: {
  readonly EMAIL_DELIVERY_MODE?: string
  readonly RESEND_API_KEY?: string
  readonly EMAIL_FROM?: string
  readonly EMAIL_LIVE_VERIFIED_AT?: string
}): EmailSender {
  const mode = env.EMAIL_DELIVERY_MODE
  if (mode === 'capture') return capturingEmailSender
  if (mode !== 'resend-test' && mode !== 'resend-live') {
    throw new Error('Invalid email delivery mode')
  }
  if ((env.RESEND_API_KEY ?? '') === '' || (env.EMAIL_FROM ?? '') === '') {
    throw new Error('Incomplete email delivery configuration')
  }
  if (mode === 'resend-live') {
    const verifiedAt = env.EMAIL_LIVE_VERIFIED_AT ?? ''
    if (
      !Number.isFinite(Date.parse(verifiedAt)) ||
      new Date(Date.parse(verifiedAt)).toISOString() !== verifiedAt
    ) {
      throw new Error('Incomplete email delivery live verification')
    }
  }
  return createResendEmailSender({
    apiKey: env.RESEND_API_KEY ?? '',
    from: env.EMAIL_FROM ?? '',
  })
}
