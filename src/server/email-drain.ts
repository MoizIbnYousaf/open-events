import type { ServerContext } from './env'
import type { ServerDeps } from './container'
import { EmailDeliveryService } from '../application/services/email-delivery'
import type { EmailDrainSummary } from '../application/services/email-delivery'
import type { EmailSender } from '../application/ports/email-sender'
import { createEmailDeliveryRepository } from '../db/email-delivery-repository'
import { selectEmailSender } from './email'
import { emailDeliveryConfigFromBindings, type ServerBindings } from './env'

/**
 * Low-latency best effort after the D1 commit. The job row is durable; failure
 * to obtain an execution context or finish this attempt leaves it for the
 * scheduled recovery drain rather than affecting the initiating mutation.
 */
export function scheduleEmailDrain(context: ServerContext, deps: ServerDeps): void {
  if (context.env.EMAIL_DELIVERY_MODE === 'capture') return
  try {
    context.executionCtx.waitUntil(deps.emailDelivery.drain({ limit: 1 }).then(() => undefined))
  } catch {
    // `app.request()` unit/integration calls have no Worker execution context.
    // They assert the durable queued row directly and never perform network I/O.
  }
}

/** Recovery drain used by Cron. D1 leasing keeps this safe beside request drains. */
export async function runScheduledEmailDrain(
  env: ServerBindings,
  sender: EmailSender = selectEmailSender(env),
): Promise<EmailDrainSummary | undefined> {
  if (env.EMAIL_DELIVERY_MODE === 'capture') return
  const service = new EmailDeliveryService(
    createEmailDeliveryRepository(env.DB),
    sender,
    emailDeliveryConfigFromBindings(env),
    { now: () => new Date().toISOString() },
  )
  const summary = await service.drain({ limit: 25, owner: `cron-${crypto.randomUUID()}` })
  console.log(
    JSON.stringify({
      event: 'email_delivery_drain',
      environment: env.DEPLOY_ENVIRONMENT ?? 'unconfigured',
      build: env.BUILD_REVISION ?? 'unconfigured',
      ...summary,
    }),
  )
  return summary
}
