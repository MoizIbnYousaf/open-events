import { describe, expect, it } from 'vitest'

import {
  DraftService,
  FormBuilderService,
  type FormBuilderUnitOfWork,
} from '../../../src/application'
import {
  DRAFT_ID,
  EVENT_ID,
  FIXED_NOW,
  FORM_ID,
  NOW,
  VERSION_ID,
  createDraft,
  createForm,
  createTaxonomyItem,
  createVersion,
  eventFixture,
  organizerActor,
  ownerActor,
} from '../helpers/fixtures'
import {
  InMemoryDraftRepository,
  InMemoryEventRepository,
  InMemoryFormContentRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemoryTaxonomyRepository,
} from '../helpers/in-memory-repositories'

class ConflictFormBuilderUnitOfWork implements FormBuilderUnitOfWork {
  readonly saveDraftCalls: Array<{ expected: unknown }> = []
  readonly publishCalls: Array<{ expected: unknown }> = []

  async saveDraft() {
    this.saveDraftCalls.push({ expected: null })
    return { outcome: 'conflict' as const }
  }

  async publish() {
    this.publishCalls.push({ expected: null })
    return { outcome: 'conflict' as const }
  }
}

function buildFormBuilderHarness() {
  const events = new InMemoryEventRepository([eventFixture])
  const forms = new InMemoryFormRepository([createForm()])
  const versions = new InMemoryFormVersionRepository()
  const content = new InMemoryFormContentRepository()
  const taxonomies = new InMemoryTaxonomyRepository([[EVENT_ID, [createTaxonomyItem()]]])
  const unitOfWork = new ConflictFormBuilderUnitOfWork()
  const service = new FormBuilderService(events, forms, versions, content, taxonomies, unitOfWork, {
    now: () => FIXED_NOW,
  })
  return { service, unitOfWork, versions, forms }
}

describe('optimistic concurrency outcomes', () => {
  it('a stale saveDraft conflict is surfaced and nothing is persisted', async () => {
    const { service, unitOfWork, versions } = buildFormBuilderHarness()

    await expect(
      service.updateDraft(organizerActor, EVENT_ID, FORM_ID, {
        pages: [],
        elements: [],
        conditionRules: [],
        routingRules: [],
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(unitOfWork.saveDraftCalls).toHaveLength(1)
    expect(await versions.listByForm(FORM_ID)).toEqual([])
  })

  it('a stale publish conflict leaves the version and form pointer untouched', async () => {
    const { service, unitOfWork, versions, forms } = buildFormBuilderHarness()
    const draft = createVersion({ id: 'version-draft-1' })
    await versions.save(draft)

    await expect(service.publish(organizerActor, EVENT_ID, FORM_ID)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(unitOfWork.publishCalls).toHaveLength(1)
    expect((await versions.listByForm(FORM_ID))[0]?.status).toBe('draft')
    expect((await forms.findById(FORM_ID))?.publishedVersionId).toBeNull()
  })

  it('a stale draft save returns false from the repository without overwriting', async () => {
    const drafts = new InMemoryDraftRepository([createDraft()])
    const form = createForm({ status: 'published', publishedVersionId: VERSION_ID })
    const version = createVersion({
      status: 'published',
      contentHash: 'hash',
      publishedAt: NOW,
    })
    const service = new DraftService(
      drafts,
      new InMemoryFormRepository([form]),
      new InMemoryFormVersionRepository([version]),
      { now: () => FIXED_NOW },
    )
    await service.save(ownerActor, {
      id: DRAFT_ID,
      formId: FORM_ID,
      formVersionId: VERSION_ID,
      title: 'Newer title',
      answers: {},
    })
    const staleStamp = '2026-05-20T08:00:00.000Z'

    const saved = await drafts.save(
      { ...createDraft(), title: 'Stale title', updatedAt: staleStamp },
      staleStamp,
    )

    expect(saved).toBe(false)
    expect(drafts.list()[0]?.title).toBe('Newer title')
  })

  it('a fresh optimistic save succeeds exactly once', async () => {
    const drafts = new InMemoryDraftRepository()
    const draft = createDraft()

    expect(await drafts.save(draft, null)).toBe(true)
    expect(await drafts.save({ ...draft, updatedAt: '2026-05-20T10:00:00.000Z' }, NOW)).toBe(true)
    expect(await drafts.save({ ...draft, title: 'dup' }, NOW)).toBe(false)
    expect(drafts.list()).toHaveLength(1)
  })
})
