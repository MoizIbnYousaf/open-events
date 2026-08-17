import { useQuery } from '@tanstack/react-query'

import { ApiClientError, requestJson } from '../api/admin-events'

/** One public schedule row: labels only, never emails/contact ids/speaker ids. */
export interface PublicSpeakerCard {
  readonly name: string
  readonly jobTitle: string
  readonly company: string
}

export interface PublicScheduleSession {
  readonly submissionId: string
  readonly title: string
  readonly speakers: readonly string[]
  readonly speakerCards?: readonly PublicSpeakerCard[]
  readonly track: string
  readonly room: string
  readonly day: string
  readonly start: string
  readonly end: string
  readonly position: number | null
  readonly format?: string
  readonly description?: string
}

export interface PublicScheduleEnvelope {
  readonly timezone: string
  readonly eventName?: string
  readonly logoUrl?: string | null
  readonly logoWidth?: number | null
  readonly logoHeight?: number | null
  readonly backgroundUrl?: string | null
  readonly backgroundWidth?: number | null
  readonly backgroundHeight?: number | null
  readonly sessions: readonly PublicScheduleSession[]
}

/**
 * GET /api/public/events/:slug/schedule — the published-only PII-stripped
 * schedule envelope. A 404 (unknown event) maps to null helper-locally;
 * every other error (including 5xx) propagates.
 */
export async function getPublicSchedule(eventSlug: string): Promise<PublicScheduleEnvelope | null> {
  try {
    return await requestJson<PublicScheduleEnvelope>(
      `/api/public/events/${encodeURIComponent(eventSlug)}/schedule`,
    )
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null
    throw error
  }
}

export const publicScheduleQueryKeys = {
  schedule: (eventSlug: string) => ['public', 'schedule', eventSlug] as const,
}

export function usePublicSchedule(eventSlug: string | undefined) {
  return useQuery({
    queryKey: publicScheduleQueryKeys.schedule(eventSlug ?? ''),
    queryFn: () => getPublicSchedule(eventSlug as string),
    enabled: eventSlug !== undefined,
    retry: false,
  })
}
