import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  archiveSupportChat,
  fetchSupportSession,
  getSupportChat,
  identifySupport,
  listSupportChats,
  markSupportRead,
  sendAdminSupportMessage,
  sendSupportMessage,
  unarchiveSupportChat,
} from '../api/support'

export const supportKeys = {
  session: (slug: string) => ['support', 'session', slug] as const,
  list: (slug: string, archived: boolean) => ['admin', 'support', slug, archived] as const,
  chat: (slug: string, id: string) => ['admin', 'support', slug, 'chat', id] as const,
}

export function useSupportSession(eventSlug: string, open: boolean, enabled = true) {
  return useQuery({
    queryKey: supportKeys.session(eventSlug),
    queryFn: () => fetchSupportSession(eventSlug),
    refetchInterval: open ? 4_000 : 12_000,
    enabled,
    retry: false,
  })
}

export function useIdentifySupport(eventSlug: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { readonly name: string; readonly email: string }) =>
      identifySupport({ eventSlug, ...input }),
    onSuccess: (data) => {
      client.setQueryData(supportKeys.session(eventSlug), data)
    },
  })
}

export function useSendSupportMessage(eventSlug: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => sendSupportMessage({ eventSlug, content }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: supportKeys.session(eventSlug) })
    },
  })
}

export function useMarkSupportRead(eventSlug: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => markSupportRead(eventSlug),
    onSuccess: (data) => {
      client.setQueryData(supportKeys.session(eventSlug), (current) =>
        current === undefined ? current : { ...current, chat: data },
      )
    },
  })
}

export function useSupportChatList(slug: string, archived: boolean) {
  return useQuery({
    queryKey: supportKeys.list(slug, archived),
    queryFn: () => listSupportChats(slug, archived),
    refetchInterval: 4_000,
  })
}

export function useAdminSupportChat(slug: string, chatId: string | null) {
  return useQuery({
    queryKey: supportKeys.chat(slug, chatId ?? ''),
    queryFn: () => getSupportChat(slug, chatId ?? ''),
    enabled: chatId !== null,
    refetchInterval: 4_000,
  })
}

export function useSendAdminSupportMessage(slug: string, chatId: string | null) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (content: string) => sendAdminSupportMessage(slug, chatId ?? '', content),
    onSuccess: () => {
      if (chatId !== null) {
        void client.invalidateQueries({ queryKey: supportKeys.chat(slug, chatId) })
      }
      void client.invalidateQueries({ queryKey: ['admin', 'support', slug] })
    },
  })
}

export function useArchiveSupportChat(slug: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { readonly chatId: string; readonly archived: boolean }) =>
      input.archived
        ? archiveSupportChat(slug, input.chatId)
        : unarchiveSupportChat(slug, input.chatId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'support', slug] })
    },
  })
}
