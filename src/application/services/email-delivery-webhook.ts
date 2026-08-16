import type {
  ResendDeliveryEvent,
  ResendDeliveryEventType,
} from '../ports/email-delivery-webhook-repository'
import type { ProviderEmailStatus } from '../ports/email-delivery-repository'

export interface ProjectedEmailDelivery {
  readonly status: ProviderEmailStatus
  readonly at: string | null
  readonly eventId: string | null
}

function eventStatus(type: ResendDeliveryEventType): Exclude<ProviderEmailStatus, 'accepted'> {
  if (type === 'email.sent') return 'sent'
  if (type === 'email.delivery_delayed') return 'delayed'
  if (type === 'email.delivered') return 'delivered'
  if (type === 'email.bounced') return 'bounced'
  if (type === 'email.complained') return 'complained'
  return 'failed'
}

function canProject(current: ProviderEmailStatus, next: ProviderEmailStatus): boolean {
  if (current === 'accepted' || current === 'sent') {
    return ['sent', 'delayed', 'delivered', 'bounced', 'failed', 'complained'].includes(next)
  }
  if (current === 'delayed') {
    return ['sent', 'delivered', 'bounced', 'failed', 'complained'].includes(next)
  }
  if (current === 'delivered') return next === 'complained'
  return false
}

/**
 * Replays the immutable event ledger in provider timestamp/id order. Folding
 * from scratch makes out-of-order arrivals deterministic; terminal outcomes
 * cannot be regressed by a later delivery attempt or replay.
 */
export function projectEmailDeliveryEvents(
  events: readonly ResendDeliveryEvent[],
): ProjectedEmailDelivery {
  let projection: ProjectedEmailDelivery = { status: 'accepted', at: null, eventId: null }
  const ordered = [...events].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  )
  for (const event of ordered) {
    const next = eventStatus(event.type)
    if (!canProject(projection.status, next)) continue
    projection = { status: next, at: event.createdAt, eventId: event.id }
  }
  return projection
}
