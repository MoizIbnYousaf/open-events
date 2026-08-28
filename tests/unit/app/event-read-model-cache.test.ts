import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  eventReadModelKeysFor,
  invalidateCachedOnboardingReadModels,
  invalidateCachedProgrammeTimelines,
  invalidateEventReadModels,
} from '../../../src/app/queries/event-read-model-cache'

const SLUG = 'demo-conf-2026'

describe('event read-model cache', () => {
  it('maps verdicts to every affected desk and lifecycle projection', () => {
    expect(eventReadModelKeysFor(SLUG, 'verdict')).toEqual([
      ['admin', 'events', SLUG, 'programme-timeline'],
      ['admin', 'events', SLUG, 'submissions'],
      ['admin', 'events', SLUG, 'submission-desk'],
      ['admin', 'events', SLUG, 'speakers'],
      ['admin', 'events', SLUG, 'readiness'],
      ['admin', 'events', SLUG, 'agenda'],
    ])
  })

  it('keeps communication invalidation narrow but includes both event-wide reads', async () => {
    expect(eventReadModelKeysFor(SLUG, 'communication')).toEqual([
      ['admin', 'events', SLUG, 'programme-timeline'],
      ['admin', 'events', SLUG, 'messages'],
    ])

    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
    await invalidateEventReadModels(client, SLUG, 'communication')
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      eventReadModelKeysFor(SLUG, 'communication'),
    )
  })

  it('does not invalidate unrelated event desks for a review assignment', () => {
    expect(eventReadModelKeysFor(SLUG, 'review-assignment')).toEqual([
      ['admin', 'events', SLUG, 'programme-timeline'],
    ])
  })

  it('refreshes messages and timeline after reviewer invitations change', () => {
    expect(eventReadModelKeysFor(SLUG, 'review-invite')).toEqual([
      ['admin', 'events', SLUG, 'programme-timeline'],
      ['admin', 'events', SLUG, 'messages'],
    ])
  })

  it('refreshes both organizer and public schedules after agenda changes', () => {
    expect(eventReadModelKeysFor(SLUG, 'agenda')).toEqual([
      ['admin', 'events', SLUG, 'programme-timeline'],
      ['admin', 'events', SLUG, 'agenda'],
      ['public', 'schedule', SLUG],
    ])
  })

  it('invalidates only cached timeline projections after a public review write', async () => {
    const client = new QueryClient()
    const timeline = ['admin', 'events', SLUG, 'programme-timeline'] as const
    const filteredTimeline = [...timeline, 'reviews'] as const
    const messages = ['admin', 'events', SLUG, 'messages'] as const
    client.setQueryData(timeline, [])
    client.setQueryData(filteredTimeline, [])
    client.setQueryData(messages, [])

    await invalidateCachedProgrammeTimelines(client)

    expect(client.getQueryState(timeline)?.isInvalidated).toBe(true)
    expect(client.getQueryState(filteredTimeline)?.isInvalidated).toBe(true)
    expect(client.getQueryState(messages)?.isInvalidated).toBe(false)
  })

  it('invalidates cached onboarding projections after a public task write', async () => {
    const client = new QueryClient()
    const timeline = ['admin', 'events', SLUG, 'programme-timeline'] as const
    const speakers = ['admin', 'events', SLUG, 'speakers'] as const
    const readiness = ['admin', 'events', SLUG, 'readiness'] as const
    const agenda = ['admin', 'events', SLUG, 'agenda'] as const
    for (const key of [timeline, speakers, readiness, agenda]) client.setQueryData(key, [])

    await invalidateCachedOnboardingReadModels(client)

    expect(client.getQueryState(timeline)?.isInvalidated).toBe(true)
    expect(client.getQueryState(speakers)?.isInvalidated).toBe(true)
    expect(client.getQueryState(readiness)?.isInvalidated).toBe(true)
    expect(client.getQueryState(agenda)?.isInvalidated).toBe(false)
  })
})
