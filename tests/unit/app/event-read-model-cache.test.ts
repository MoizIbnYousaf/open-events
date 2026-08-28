import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  eventReadModelKeysFor,
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
})
