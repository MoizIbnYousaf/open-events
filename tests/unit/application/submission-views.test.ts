import { describe, expect, it, vi } from 'vitest'

import { toOrganizerActor } from '../../../src/application/actors'
import type {
  SubmissionViewRecord,
  SubmissionViewRepository,
} from '../../../src/application/ports/submission-view-repository'
import { SubmissionViewService } from '../../../src/application/services/submission-views'
import { createOrganizerSession, organizerActor } from '../helpers/fixtures'

const EVENT_ID = 'event-1'
const NOW = '2026-08-28T12:00:00.000Z'
const STATE = {
  schemaVersion: 1 as const,
  decision: 'pending' as const,
  routing: 'ai',
  sort: 'title-asc' as const,
  facets: [{ elementId: 'element-format', values: ['Talk'] }],
}

function record(overrides: Partial<SubmissionViewRecord> = {}): SubmissionViewRecord {
  return {
    eventId: EVENT_ID,
    id: 'view-1',
    name: 'Needs review',
    state: STATE,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function repository(overrides: Partial<SubmissionViewRepository> = {}): SubmissionViewRepository {
  return {
    listByEvent: vi.fn(async () => [record()]),
    create: vi.fn(async () => 'created' as const),
    delete: vi.fn(async () => 'deleted' as const),
    ...overrides,
  }
}

describe('SubmissionViewService', () => {
  it('creates one canonical event-wide view without transient route state', async () => {
    const repo = repository()
    const service = new SubmissionViewService(repo, { now: () => NOW }, () => 'view-created')

    const created = await service.create(organizerActor, EVENT_ID, {
      name: '  Needs review  ',
      state: { ...STATE, facets: [{ elementId: 'element-format', values: ['Talk', 'Talk'] }] },
    })

    expect(repo.create).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      id: 'view-created',
      name: 'Needs review',
      state: STATE,
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(created).toEqual({
      eventId: EVENT_ID,
      id: 'view-created',
      name: 'Needs review',
      state: STATE,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('reports duplicate names as a conflict and guessed ids as safe not-found', async () => {
    const duplicate = new SubmissionViewService(
      repository({ create: vi.fn(async () => 'duplicate' as const) }),
      { now: () => NOW },
      () => 'view-duplicate',
    )
    await expect(
      duplicate.create(organizerActor, EVENT_ID, { name: 'Needs review', state: STATE }),
    ).rejects.toMatchObject({ code: 'conflict' })

    const missing = new SubmissionViewService(
      repository({ delete: vi.fn(async () => 'not-found' as const) }),
      { now: () => NOW },
      () => 'unused',
    )
    await expect(missing.delete(organizerActor, EVENT_ID, 'view-guessed')).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('allows tour authority to read but never create or delete views', async () => {
    const actor = toOrganizerActor(createOrganizerSession({ provenance: 'tour' }))
    if (actor === null) throw new Error('Expected organizer actor')
    const repo = repository()
    const service = new SubmissionViewService(repo, { now: () => NOW }, () => 'view-tour')

    expect(await service.list(actor, EVENT_ID)).toEqual([record()])
    await expect(
      service.create(actor, EVENT_ID, { name: 'Tour view', state: STATE }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(service.delete(actor, EVENT_ID, 'view-1')).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  it('rejects a schema-valid snapshot that would exceed the storage bound', async () => {
    const repo = repository()
    const service = new SubmissionViewService(repo, { now: () => NOW }, () => 'view-large')
    const values = Array.from(
      { length: 64 },
      (_, index) => `${index.toString().padStart(2, '0')}-${'x'.repeat(197)}`,
    )

    await expect(
      service.create(organizerActor, EVENT_ID, {
        name: 'Too broad',
        state: {
          ...STATE,
          facets: [
            { elementId: 'element-1', values: values.slice(0, 20) },
            { elementId: 'element-2', values: values.slice(20, 40) },
            { elementId: 'element-3', values: values.slice(40, 60) },
            { elementId: 'element-4', values: values.slice(60) },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
    expect(repo.create).not.toHaveBeenCalled()
  })
})
