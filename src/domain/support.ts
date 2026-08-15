import type { ContactId } from './contact.ts'
import type { EventId, UtcInstant } from './event.ts'

export type SupportChatId = string
export type SupportMessageId = string

export const SUPPORT_SENDER_TYPES = ['user', 'admin'] as const
export type SupportSenderType = (typeof SUPPORT_SENDER_TYPES)[number]

export const ORBY_NAME = 'Orby'
export const SUPPORT_MESSAGE_MAX_LENGTH = 4000
export const SUPPORT_NOTIFY_DELAY_MS = 5 * 60 * 1000
export const SUPPORT_GUEST_COOKIE = 'oe_orby'

export function isSupportSenderType(value: unknown): value is SupportSenderType {
  return value === 'user' || value === 'admin'
}

export interface SupportChat {
  readonly id: SupportChatId
  readonly eventId: EventId
  readonly contactId: ContactId
  readonly lastMessageAt: UtcInstant | null
  readonly adminViewedAt: UtcInstant | null
  readonly archivedAt: UtcInstant | null
  readonly guestTokenHash: string | null
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
}

export interface SupportMessage {
  readonly id: SupportMessageId
  readonly chatId: SupportChatId
  readonly content: string
  readonly senderType: SupportSenderType
  readonly readAt: UtcInstant | null
  readonly notifyAfter: UtcInstant | null
  readonly notifiedAt: UtcInstant | null
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
}

export function isArchived(chat: SupportChat): boolean {
  return chat.archivedAt !== null
}

export function unreadForAdmin(chat: SupportChat, messages: readonly SupportMessage[]): boolean {
  const viewed = chat.adminViewedAt
  return messages.some(
    (message) => message.senderType === 'user' && (viewed === null || message.createdAt > viewed),
  )
}

export function unreadAdminCount(messages: readonly SupportMessage[]): number {
  return messages.filter((message) => message.senderType === 'admin' && message.readAt === null)
    .length
}
