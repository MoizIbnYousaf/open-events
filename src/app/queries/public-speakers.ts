import { useQuery } from '@tanstack/react-query'

import { ApiClientError, requestJson } from '../api/admin-events'

export interface PublicSpeakerSession {
  readonly submissionId: string
  readonly title: string
  readonly day: string
  readonly start: string
  readonly end: string
  readonly room: string
}

export interface PublicSpeaker {
  readonly id: string
  readonly name: string
  readonly jobTitle: string
  readonly company: string
  readonly bio: string
  readonly hasHeadshot: boolean
  readonly photoUrl: string | null
  readonly sessions: readonly PublicSpeakerSession[]
}

export async function getPublicSpeakers(
  eventSlug: string,
): Promise<readonly PublicSpeaker[] | null> {
  try {
    const body = await requestJson<{ speakers: readonly PublicSpeaker[] }>(
      `/api/public/events/${encodeURIComponent(eventSlug)}/speakers`,
    )
    return body.speakers
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null
    throw error
  }
}

export async function getPublicSpeaker(
  eventSlug: string,
  contactId: string,
): Promise<PublicSpeaker | null> {
  try {
    return await requestJson<PublicSpeaker>(
      `/api/public/events/${encodeURIComponent(eventSlug)}/speakers/${encodeURIComponent(contactId)}`,
    )
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null
    throw error
  }
}

export function usePublicSpeakers(eventSlug: string | undefined) {
  return useQuery({
    queryKey: ['public', 'speakers', eventSlug ?? ''],
    queryFn: () => getPublicSpeakers(eventSlug as string),
    enabled: eventSlug !== undefined,
    retry: false,
  })
}

export function usePublicSpeaker(eventSlug: string | undefined, contactId: string | undefined) {
  return useQuery({
    queryKey: ['public', 'speaker', eventSlug ?? '', contactId ?? ''],
    queryFn: () => getPublicSpeaker(eventSlug as string, contactId as string),
    enabled: eventSlug !== undefined && contactId !== undefined,
    retry: false,
  })
}
