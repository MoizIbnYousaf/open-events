import { describe, expect, it, vi } from 'vitest'

import type { ProgrammeTimelineItemDto } from '../../../src/application/dtos/programme-timeline.dto'
import type { ProgrammeTimelineRepository } from '../../../src/application/ports/programme-timeline-repository'
import { ProgrammeTimelineService } from '../../../src/application/services/programme-timeline'
import { organizerActor } from '../helpers/fixtures'

function item(
  id: string,
  occurredAt: string,
  category: ProgrammeTimelineItemDto['category'] = 'submissions',
): ProgrammeTimelineItemDto {
  return {
    id,
    kind: category === 'reviews' ? 'review_saved' : 'proposal_submitted',
    category,
    occurredAt,
    title: 'Milestone',
    detail: 'Source-backed detail',
    submissionId: 'submission-1',
    submissionTitle: 'Submission one',
  }
}

function repository(
  items: readonly ProgrammeTimelineItemDto[],
  truncatedCategories: readonly ProgrammeTimelineItemDto['category'][] = [],
): ProgrammeTimelineRepository {
  return { listLatest: vi.fn(async () => ({ items, truncatedCategories })) }
}

describe('ProgrammeTimelineService', () => {
  it('sorts newest first, filters categories, and keeps only the latest review snapshot', async () => {
    const service = new ProgrammeTimelineService(
      repository([
        item('submission:1', '2026-08-28T10:00:00.000Z'),
        item('review:1', '2026-08-28T11:00:00.000Z', 'reviews'),
        item('review:1', '2026-08-28T12:00:00.000Z', 'reviews'),
        item('review:2', '2026-08-28T12:00:00.000Z', 'reviews'),
      ]),
    )

    expect((await service.list(organizerActor, 'event-1', 'reviews')).items).toEqual([
      item('review:1', '2026-08-28T12:00:00.000Z', 'reviews'),
      item('review:2', '2026-08-28T12:00:00.000Z', 'reviews'),
    ])
  })

  it('caps the projection at one hundred and carries source truncation honestly', async () => {
    const items = Array.from({ length: 101 }, (_, index) =>
      item(
        `submission:${index.toString().padStart(3, '0')}`,
        new Date(Date.UTC(2026, 7, 28, 12, 0, index)).toISOString(),
      ),
    )
    const capped = await new ProgrammeTimelineService(repository(items)).list(
      organizerActor,
      'event-1',
      'all',
    )
    expect(capped.items).toHaveLength(100)
    expect(capped.truncated).toBe(true)
    expect(capped.limit).toBe(100)

    const sourceBound = new ProgrammeTimelineService(repository([items[0]!], ['submissions']))
    expect((await sourceBound.list(organizerActor, 'event-1', 'all')).truncated).toBe(true)
    expect((await sourceBound.list(organizerActor, 'event-1', 'reviews')).truncated).toBe(false)
  })
})
