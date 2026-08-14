import { describe, expect, it } from 'vitest'

import {
  isArchived,
  unreadAdminCount,
  unreadForAdmin,
  type SupportChat,
  type SupportMessage,
} from '../../../src/domain/support'

function chat(overrides: Partial<SupportChat> = {}): SupportChat {
  return {
    id: 'chat-1',
    eventId: 'event-1',
    contactId: 'contact-1',
    lastMessageAt: '2026-08-14T12:00:00.000Z',
    adminViewedAt: null,
    archivedAt: null,
    guestTokenHash: null,
    createdAt: '2026-08-14T11:00:00.000Z',
    updatedAt: '2026-08-14T12:00:00.000Z',
    ...overrides,
  }
}

function message(overrides: Partial<SupportMessage> = {}): SupportMessage {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    content: 'Hello',
    senderType: 'user',
    readAt: null,
    notifyAfter: null,
    notifiedAt: null,
    createdAt: '2026-08-14T12:00:00.000Z',
    updatedAt: '2026-08-14T12:00:00.000Z',
    ...overrides,
  }
}

describe('support chat helpers', () => {
  it('treats a missing archive stamp as active', () => {
    expect(isArchived(chat())).toBe(false)
    expect(isArchived(chat({ archivedAt: '2026-08-14T13:00:00.000Z' }))).toBe(true)
  })

  it('flags unread user mail after the last admin view', () => {
    const viewed = chat({ adminViewedAt: '2026-08-14T12:00:00.000Z' })
    expect(unreadForAdmin(viewed, [message({ createdAt: '2026-08-14T11:00:00.000Z' })])).toBe(false)
    expect(unreadForAdmin(viewed, [message({ createdAt: '2026-08-14T12:01:00.000Z' })])).toBe(true)
    expect(unreadForAdmin(chat(), [message()])).toBe(true)
  })

  it('counts unread Orby replies for the widget badge', () => {
    expect(
      unreadAdminCount([
        message({ senderType: 'admin', readAt: null }),
        message({ id: 'msg-2', senderType: 'admin', readAt: '2026-08-14T12:05:00.000Z' }),
        message({ id: 'msg-3', senderType: 'user' }),
      ]),
    ).toBe(1)
  })
})
