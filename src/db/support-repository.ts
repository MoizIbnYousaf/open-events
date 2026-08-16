import type { D1Database } from '@cloudflare/workers-types'

import type {
  DueSupportNotification,
  SupportChatInsert,
  SupportChatListRow,
  SupportRepository,
} from '../application/ports/support-repository'
import type { SupportChat, SupportMessage, SupportSenderType } from '../domain/support'
import { isSupportSenderType } from '../domain/support'

interface RawChatRow {
  readonly id: string
  readonly event_id: string
  readonly contact_id: string
  readonly last_message_at: string | null
  readonly admin_viewed_at: string | null
  readonly archived_at: string | null
  readonly guest_token_hash: string | null
  readonly created_at: string
  readonly updated_at: string
}

interface RawMessageRow {
  readonly id: string
  readonly chat_id: string
  readonly content: string
  readonly sender_type: string
  readonly read_at: string | null
  readonly notify_after: string | null
  readonly notified_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

interface RawListRow extends RawChatRow {
  readonly contact_email: string
  readonly contact_name: string
  readonly last_preview: string | null
  readonly last_sender: string | null
  readonly message_count: number
  readonly unread: number
}

interface RawDueRow extends RawMessageRow {
  readonly event_id: string
  readonly contact_id: string
  readonly last_message_at: string | null
  readonly admin_viewed_at: string | null
  readonly archived_at: string | null
  readonly guest_token_hash: string | null
  readonly chat_created_at: string
  readonly chat_updated_at: string
  readonly contact_email: string
  readonly contact_name: string
  readonly event_name: string
}

const CHAT_COLS = `id, event_id, contact_id, last_message_at, admin_viewed_at, archived_at,
                   guest_token_hash, created_at, updated_at`

function mapChat(row: RawChatRow): SupportChat {
  return {
    id: row.id,
    eventId: row.event_id,
    contactId: row.contact_id,
    lastMessageAt: row.last_message_at,
    adminViewedAt: row.admin_viewed_at,
    archivedAt: row.archived_at,
    guestTokenHash: row.guest_token_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMessage(row: RawMessageRow): SupportMessage {
  const senderType: SupportSenderType = isSupportSenderType(row.sender_type)
    ? row.sender_type
    : 'user'
  return {
    id: row.id,
    chatId: row.chat_id,
    content: row.content,
    senderType,
    readAt: row.read_at,
    notifyAfter: row.notify_after,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createSupportRepository(db: D1Database): SupportRepository {
  return {
    async findChatById(id) {
      const row = await db
        .prepare(`SELECT ${CHAT_COLS} FROM support_chats WHERE id = ?`)
        .bind(id)
        .first<RawChatRow>()
      return row === null ? null : mapChat(row)
    },
    async findChatByEventAndContact(eventId, contactId) {
      const row = await db
        .prepare(`SELECT ${CHAT_COLS} FROM support_chats WHERE event_id = ? AND contact_id = ?`)
        .bind(eventId, contactId)
        .first<RawChatRow>()
      return row === null ? null : mapChat(row)
    },
    async findChatByGuestTokenHash(hash) {
      const row = await db
        .prepare(`SELECT ${CHAT_COLS} FROM support_chats WHERE guest_token_hash = ?`)
        .bind(hash)
        .first<RawChatRow>()
      return row === null ? null : mapChat(row)
    },
    async insertChat(chat: SupportChatInsert) {
      await db
        .prepare(
          `INSERT INTO support_chats
             (id, event_id, contact_id, last_message_at, admin_viewed_at, archived_at,
              guest_token_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          chat.id,
          chat.eventId,
          chat.contactId,
          chat.lastMessageAt,
          chat.adminViewedAt,
          chat.archivedAt,
          chat.guestTokenHash,
          chat.createdAt,
          chat.updatedAt,
        )
        .run()
    },
    async setGuestTokenHash(chatId, hash, updatedAt) {
      await db
        .prepare(`UPDATE support_chats SET guest_token_hash = ?, updated_at = ? WHERE id = ?`)
        .bind(hash, updatedAt, chatId)
        .run()
    },
    async setArchivedAt(chatId, archivedAt, updatedAt) {
      await db
        .prepare(`UPDATE support_chats SET archived_at = ?, updated_at = ? WHERE id = ?`)
        .bind(archivedAt, updatedAt, chatId)
        .run()
    },
    async setAdminViewedAt(chatId, viewedAt, updatedAt) {
      await db
        .prepare(`UPDATE support_chats SET admin_viewed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(viewedAt, updatedAt, chatId)
        .run()
    },
    async insertMessageAndTouchChat(input) {
      const message = input.message
      await db.batch([
        db
          .prepare(
            `INSERT INTO support_messages
               (id, chat_id, content, sender_type, read_at, notify_after, notified_at,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            message.id,
            message.chatId,
            message.content,
            message.senderType,
            message.readAt,
            message.notifyAfter,
            message.notifiedAt,
            message.createdAt,
            message.updatedAt,
          ),
        db
          .prepare(
            input.unarchive
              ? `UPDATE support_chats
                   SET last_message_at = ?, archived_at = NULL, updated_at = ?
                 WHERE id = ?`
              : `UPDATE support_chats
                   SET last_message_at = ?, updated_at = ?
                 WHERE id = ?`,
          )
          .bind(input.lastMessageAt, input.lastMessageAt, message.chatId),
      ])
    },
    async listMessages(chatId) {
      const result = await db
        .prepare(
          `SELECT id, chat_id, content, sender_type, read_at, notify_after, notified_at,
                  created_at, updated_at
             FROM support_messages
            WHERE chat_id = ?
            ORDER BY created_at ASC, id ASC`,
        )
        .bind(chatId)
        .all<RawMessageRow>()
      return (result.results ?? []).map(mapMessage)
    },
    async markAdminMessagesRead(chatId, readAt) {
      await db
        .prepare(
          `UPDATE support_messages
              SET read_at = ?, updated_at = ?
            WHERE chat_id = ? AND sender_type = 'admin' AND read_at IS NULL`,
        )
        .bind(readAt, readAt, chatId)
        .run()
    },
    async listChatsByEvent(eventId, archived) {
      const archiveClause = archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL'
      const result = await db
        .prepare(
          `SELECT c.id, c.event_id, c.contact_id, c.last_message_at, c.admin_viewed_at,
                  c.archived_at, c.guest_token_hash, c.created_at, c.updated_at,
                  contacts.email AS contact_email, contacts.name AS contact_name,
                  (SELECT content FROM support_messages
                    WHERE chat_id = c.id
                    ORDER BY created_at DESC, id DESC LIMIT 1) AS last_preview,
                  (SELECT sender_type FROM support_messages
                    WHERE chat_id = c.id
                    ORDER BY created_at DESC, id DESC LIMIT 1) AS last_sender,
                  (SELECT COUNT(*) FROM support_messages WHERE chat_id = c.id) AS message_count,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM support_messages m
                     WHERE m.chat_id = c.id
                       AND m.sender_type = 'user'
                       AND (c.admin_viewed_at IS NULL OR m.created_at > c.admin_viewed_at)
                  ) THEN 1 ELSE 0 END AS unread
             FROM support_chats c
             JOIN contacts ON contacts.id = c.contact_id
            WHERE c.event_id = ? AND ${archiveClause}
            ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.created_at DESC`,
        )
        .bind(eventId)
        .all<RawListRow>()
      return (result.results ?? []).map((row): SupportChatListRow => {
        const lastSender = isSupportSenderType(row.last_sender) ? row.last_sender : null
        return {
          chat: mapChat(row),
          contactEmail: row.contact_email,
          contactName: row.contact_name,
          lastMessagePreview: row.last_preview,
          lastMessageSender: lastSender,
          messageCount: row.message_count,
          unreadForAdmin: row.unread === 1,
        }
      })
    },
    async listDueNotifications(now) {
      const result = await db
        .prepare(
          `SELECT m.id, m.chat_id, m.content, m.sender_type, m.read_at, m.notify_after,
                  m.notified_at, m.created_at, m.updated_at,
                  c.event_id, c.contact_id, c.last_message_at, c.admin_viewed_at,
                  c.archived_at, c.guest_token_hash, c.created_at AS chat_created_at,
                  c.updated_at AS chat_updated_at,
                  contacts.email AS contact_email, contacts.name AS contact_name,
                  events.name AS event_name
             FROM support_messages m
             JOIN support_chats c ON c.id = m.chat_id
             JOIN contacts ON contacts.id = c.contact_id
             JOIN events ON events.id = c.event_id
            WHERE m.sender_type = 'admin'
              AND m.notify_after IS NOT NULL
              AND m.notify_after <= ?
              AND m.notified_at IS NULL
              AND m.read_at IS NULL
              AND c.archived_at IS NULL`,
        )
        .bind(now)
        .all<RawDueRow>()
      return (result.results ?? []).map((row): DueSupportNotification => ({
        message: mapMessage(row),
        chat: {
          id: row.chat_id,
          eventId: row.event_id,
          contactId: row.contact_id,
          lastMessageAt: row.last_message_at,
          adminViewedAt: row.admin_viewed_at,
          archivedAt: row.archived_at,
          guestTokenHash: row.guest_token_hash,
          createdAt: row.chat_created_at,
          updatedAt: row.chat_updated_at,
        },
        contactEmail: row.contact_email,
        contactName: row.contact_name,
        eventName: row.event_name,
      }))
    },
    async markNotified(messageIds, notifiedAt) {
      if (messageIds.length === 0) return
      const statements = messageIds.map((id) =>
        db
          .prepare(`UPDATE support_messages SET notified_at = ?, updated_at = ? WHERE id = ?`)
          .bind(notifiedAt, notifiedAt, id),
      )
      await db.batch(statements)
    },
  }
}
