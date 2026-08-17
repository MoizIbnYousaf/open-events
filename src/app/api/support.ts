import type {
  AdminSupportChatDto,
  SupportChatDto,
  SupportChatListItemDto,
  SupportMessageDto,
  SupportSessionDto,
} from '../../application/services/support'
import { requestJson } from './admin-events'

export function fetchSupportSession(eventSlug: string): Promise<SupportSessionDto> {
  return requestJson<SupportSessionDto>(
    `/api/support-chat?eventSlug=${encodeURIComponent(eventSlug)}`,
  )
}

export function identifySupport(input: {
  readonly eventSlug: string
  readonly name: string
  readonly email: string
}): Promise<SupportSessionDto> {
  return requestJson<SupportSessionDto>('/api/support-chat', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function sendSupportMessage(input: {
  readonly eventSlug: string
  readonly content: string
  readonly pagePath: string
}): Promise<SupportMessageDto> {
  return requestJson<SupportMessageDto>('/api/support-chat/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function askOrganizerOrby(input: {
  readonly eventSlug: string
  readonly pagePath: string
  readonly content: string
  readonly history: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
}): Promise<{ readonly content: string }> {
  return requestJson<{ readonly content: string }>(
    `/api/admin/events/${input.eventSlug}/orby/ask`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function markSupportRead(eventSlug: string): Promise<SupportChatDto> {
  return requestJson<SupportChatDto>(
    `/api/support-chat/mark-read?eventSlug=${encodeURIComponent(eventSlug)}`,
    { method: 'PATCH' },
  )
}

export function listSupportChats(
  slug: string,
  archived: boolean,
): Promise<readonly SupportChatListItemDto[]> {
  return requestJson<readonly SupportChatListItemDto[]>(
    `/api/admin/events/${slug}/support/chats?archived=${archived ? 'true' : 'false'}`,
  )
}

export function getSupportChat(slug: string, chatId: string): Promise<AdminSupportChatDto> {
  return requestJson<AdminSupportChatDto>(`/api/admin/events/${slug}/support/chats/${chatId}`)
}

export function sendAdminSupportMessage(
  slug: string,
  chatId: string,
  content: string,
): Promise<SupportMessageDto> {
  return requestJson<SupportMessageDto>(
    `/api/admin/events/${slug}/support/chats/${chatId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
    },
  )
}

export function archiveSupportChat(slug: string, chatId: string): Promise<AdminSupportChatDto> {
  return requestJson<AdminSupportChatDto>(
    `/api/admin/events/${slug}/support/chats/${chatId}/archive`,
    { method: 'POST' },
  )
}

export function unarchiveSupportChat(slug: string, chatId: string): Promise<AdminSupportChatDto> {
  return requestJson<AdminSupportChatDto>(
    `/api/admin/events/${slug}/support/chats/${chatId}/unarchive`,
    { method: 'POST' },
  )
}
