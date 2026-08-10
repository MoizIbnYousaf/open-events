import type { ContactId } from '../../domain/contact'
import type { EventId, UtcInstant } from '../../domain/event'
import type {
  SupportChat,
  SupportChatId,
  SupportMessage,
  SupportSenderType,
} from '../../domain/support'

export interface SupportChatListRow {
  readonly chat: SupportChat
  readonly contactEmail: string
  readonly contactName: string
  readonly lastMessagePreview: string | null
  readonly lastMessageSender: SupportSenderType | null
  readonly messageCount: number
  readonly unreadForAdmin: boolean
}

export interface SupportMessageInsert {
  readonly id: string
  readonly chatId: SupportChatId
  readonly content: string
  readonly senderType: SupportSenderType
  readonly readAt: UtcInstant | null
  readonly notifyAfter: UtcInstant | null
  readonly notifiedAt: UtcInstant | null
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
}

export interface SupportChatInsert {
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

export interface DueSupportNotification {
  readonly message: SupportMessage
  readonly chat: SupportChat
  readonly contactEmail: string
  readonly contactName: string
  readonly eventName: string
}

export interface SupportRepository {
  findChatById(id: SupportChatId): Promise<SupportChat | null>
  findChatByEventAndContact(eventId: EventId, contactId: ContactId): Promise<SupportChat | null>
  findChatByGuestTokenHash(hash: string): Promise<SupportChat | null>
  insertChat(chat: SupportChatInsert): Promise<void>
  setGuestTokenHash(chatId: SupportChatId, hash: string, updatedAt: UtcInstant): Promise<void>
  setArchivedAt(
    chatId: SupportChatId,
    archivedAt: UtcInstant | null,
    updatedAt: UtcInstant,
  ): Promise<void>
  setAdminViewedAt(
    chatId: SupportChatId,
    viewedAt: UtcInstant,
    updatedAt: UtcInstant,
  ): Promise<void>
  insertMessageAndTouchChat(input: {
    readonly message: SupportMessageInsert
    readonly lastMessageAt: UtcInstant
    readonly unarchive: boolean
  }): Promise<void>
  listMessages(chatId: SupportChatId): Promise<readonly SupportMessage[]>
  markAdminMessagesRead(chatId: SupportChatId, readAt: UtcInstant): Promise<void>
  listChatsByEvent(eventId: EventId, archived: boolean): Promise<readonly SupportChatListRow[]>
  listDueNotifications(now: UtcInstant): Promise<readonly DueSupportNotification[]>
  markNotified(messageIds: readonly string[], notifiedAt: UtcInstant): Promise<void>
}
