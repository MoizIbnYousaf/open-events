import { describe, expect, it, vi } from 'vitest'

import { DraftService, toSubmitterActor, type SaveDraftInput } from '../../../src/application'
import {
  DRAFT_ID,
  EVENT_ID,
  FIXED_NOW,
  FORM_ID,
  NOW,
  VERSION_ID,
  createDraft,
  createForm,
  createSubmitterActor,
  createSubmitterSession,
  createVersion,
} from '../helpers/fixtures'
import {
  InMemoryDraftRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
} from '../helpers/in-memory-repositories'

const ownerActor = createSubmitterActor({ capability: 'cfp' })
const foreignActor = createSubmitterActor({ capability: 'cfp', contactId: 'contact-other' })
const crossEventActor = createSubmitterActor({ capability: 'cfp', eventId: 'event-other' })

function buildHarness(
  options: {
    version?: ReturnType<typeof createVersion>
    form?: ReturnType<typeof createForm>
    versions?: InMemoryFormVersionRepository
    clockNow?: string
  } = {},
) {
  const form = options.form ?? createForm({ status: 'published', publishedVersionId: VERSION_ID })
  const version =
    options.version ?? createVersion({ status: 'published', contentHash: 'hash', publishedAt: NOW })
  const drafts = new InMemoryDraftRepository([createDraft()])
  const forms = new InMemoryFormRepository([form])
  const versions = options.versions ?? new InMemoryFormVersionRepository([version])
  const service = new DraftService(drafts, forms, versions, {
    now: () => options.clockNow ?? FIXED_NOW,
  })
  return { service, drafts, forms, versions, form, version }
}

function input(overrides: Partial<SaveDraftInput> = {}): SaveDraftInput {
  return {
    id: null,
    formId: FORM_ID,
    formVersionId: VERSION_ID,
    title: 'New draft',
    answers: { format: 'talk' },
    ...overrides,
  }
}

describe('DraftService.save', () => {
  it('derives the actor contact and event from the session, never the body', async () => {
    const { service, drafts } = buildHarness()

    const draft = await service.save(ownerActor, input())

    expect(draft.id).toBeTruthy()
    expect(draft.eventId).toBe(EVENT_ID)
    expect(draft.updatedAt).toBe(FIXED_NOW)
    const saved = drafts.list().find((candidate) => candidate.id === draft.id)
    expect(saved?.ownerContactId).toBe(ownerActor.contactId)
    expect(saved?.eventId).toBe(ownerActor.eventId)
    expect(drafts.list()).toHaveLength(2)
  })

  it('uses the injected clock for deterministic timestamps', async () => {
    const { service, drafts } = buildHarness()

    const draft = await service.save(ownerActor, input())

    expect(draft.updatedAt).toBe(FIXED_NOW)
    const saved = drafts.list().find((candidate) => candidate.id === draft.id)
    expect(saved?.createdAt).toBe(FIXED_NOW)
    expect(saved?.updatedAt).toBe(FIXED_NOW)
  })

  it('updates an existing draft owned by the session actor', async () => {
    const { service, drafts } = buildHarness()

    const updated = await service.save(ownerActor, input({ id: DRAFT_ID, title: 'Resumed draft' }))

    expect(updated.id).toBe(DRAFT_ID)
    expect(updated.title).toBe('Resumed draft')
    expect(updated.answers).toEqual({ format: 'talk' })
    expect(drafts.list()[0]?.updatedAt).toBe(FIXED_NOW)
  })

  it('rejects missing or foreign drafts with a safe not_found', async () => {
    const { service } = buildHarness()

    await expect(service.save(ownerActor, input({ id: 'draft-missing' }))).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(service.save(foreignActor, input({ id: DRAFT_ID }))).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(service.save(crossEventActor, input({ id: DRAFT_ID }))).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('rejects an empty actor contactId', async () => {
    const { service } = buildHarness()

    await expect(
      service.save(
        toSubmitterActor(createSubmitterSession({ capability: 'cfp', contactId: '   ' }))!,
        input(),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it.each(['portal', 'evaluation'] as const)(
    'rejects the %s capability before touching CFP data',
    async (capability) => {
      const { service, drafts } = buildHarness()

      await expect(
        service.save(createSubmitterActor({ capability }), input()),
      ).rejects.toMatchObject({ code: 'forbidden' })
      expect(drafts.list()).toHaveLength(1)
    },
  )

  it('rejects a fabricated null-capability actor before touching CFP data', async () => {
    const { service, drafts } = buildHarness()
    const rawNullActor = {
      contactId: 'contact-owner',
      eventId: EVENT_ID,
      capability: null,
      legacyBroadAuthority: false,
    } as never

    await expect(service.save(rawNullActor, input())).rejects.toMatchObject({ code: 'forbidden' })
    expect(drafts.list()).toHaveLength(1)
  })

  it('denies a direct tour-authority mutation before touching draft data', async () => {
    const { service, drafts } = buildHarness()
    const tourActor = createSubmitterActor({ capability: 'cfp', provenance: 'tour' })

    await expect(service.save(tourActor, input())).rejects.toMatchObject({ code: 'forbidden' })
    expect(drafts.list()).toHaveLength(1)
  })
})

describe('DraftService intake-version validation', () => {
  it('requires form and version repositories and a clock at construction', async () => {
    const drafts = new InMemoryDraftRepository([createDraft()])
    // @ts-expect-error DraftService requires forms, versions, and a clock.
    new DraftService(drafts)
  })

  it('rejects drafts against an unknown version', async () => {
    const { service } = buildHarness()

    await expect(
      service.save(ownerActor, input({ formVersionId: 'version-ghost' })),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects a version that belongs to a different event or form', async () => {
    const wrongEvent = buildHarness({
      versions: new InMemoryFormVersionRepository([
        createVersion({
          id: 'version-x',
          eventId: 'event-other',
          status: 'published',
          contentHash: 'hash',
          publishedAt: NOW,
        }),
      ]),
    })
    const wrongForm = buildHarness({
      versions: new InMemoryFormVersionRepository([
        createVersion({
          id: 'version-x',
          formId: 'form-other',
          status: 'published',
          contentHash: 'hash',
          publishedAt: NOW,
        }),
      ]),
    })

    await expect(
      wrongEvent.service.save(ownerActor, input({ formVersionId: 'version-x' })),
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      wrongForm.service.save(ownerActor, input({ formVersionId: 'version-x' })),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('requires the version to be the currently published intake version', async () => {
    const unpublished = buildHarness({ form: createForm({ status: 'draft' }) })
    const stalePointer = buildHarness({
      form: createForm({ status: 'published', publishedVersionId: 'version-other' }),
    })
    const draftVersion = buildHarness({
      version: createVersion({ status: 'draft', contentHash: null, publishedAt: null }),
    })

    await expect(unpublished.service.save(ownerActor, input())).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(stalePointer.service.save(ownerActor, input())).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(draftVersion.service.save(ownerActor, input())).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('rejects a create whose id already exists as conflict', async () => {
    const { service, drafts } = buildHarness()
    vi.spyOn(drafts, 'save').mockImplementation(async () => false)

    await expect(service.save(ownerActor, input())).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})

describe('DraftService optimistic concurrency', () => {
  it('rejects a stale updatedAt save as conflict without overwriting', async () => {
    const { service, drafts } = buildHarness()
    await service.save(ownerActor, input({ id: DRAFT_ID, title: 'Newer title' }))

    expect(drafts.list()[0]?.updatedAt).toBe(FIXED_NOW)
    // Simulate a second writer having bumped the stamp between read and write.
    vi.spyOn(drafts, 'save').mockImplementation(async () => false)

    await expect(
      service.save(ownerActor, input({ id: DRAFT_ID, title: 'Stale title' })),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(drafts.list()[0]?.title).toBe('Newer title')
  })
})

describe('DraftService reads', () => {
  it('returns only drafts owned by the requesting actor', async () => {
    const { service } = buildHarness()

    expect(await service.get(ownerActor, DRAFT_ID)).toMatchObject({ id: DRAFT_ID })
    expect(await service.get(foreignActor, DRAFT_ID)).toBeNull()
    expect(await service.get(crossEventActor, DRAFT_ID)).toBeNull()
    expect(await service.get(ownerActor, 'draft-missing')).toBeNull()
    expect(await service.listByOwner(ownerActor)).toHaveLength(1)
    expect(await service.listByOwner(foreignActor)).toEqual([])
    expect(await service.listByOwner(crossEventActor)).toEqual([])
  })

  it('returns the most recently updated active draft for the form', async () => {
    const { service, drafts } = buildHarness()
    await drafts.save(
      createDraft({
        id: 'draft-newer',
        title: 'Newer draft',
        updatedAt: '2026-05-20T08:30:00.000Z',
      }),
      null,
    )

    const active = await service.getActiveDraft(ownerActor, FORM_ID)

    expect(active?.id).toBe('draft-newer')
  })

  it('returns null when no draft exists for the form, event, or owner', async () => {
    const { service, drafts } = buildHarness()
    await drafts.save(
      createDraft({ id: 'draft-other-form', formVersionId: 'version-other-form' }),
      null,
    )
    await drafts.save(
      createDraft({
        id: 'draft-other-owner',
        ownerContactId: 'contact-other',
        updatedAt: '2026-05-20T08:30:00.000Z',
      }),
      null,
    )

    expect(await service.getActiveDraft(ownerActor, 'form-other')).toBeNull()
    expect(await service.getActiveDraft(foreignActor, FORM_ID)).toMatchObject({
      id: 'draft-other-owner',
    })
    expect(await service.getActiveDraft(crossEventActor, FORM_ID)).toBeNull()
    expect(await service.getActiveDraft(ownerActor, 'form-empty')).toBeNull()
  })

  it('returns null for the active draft after submit deletes it', async () => {
    const { service, drafts } = buildHarness()
    await drafts.deleteById(EVENT_ID, DRAFT_ID)

    expect(await service.getActiveDraft(ownerActor, FORM_ID)).toBeNull()
  })
})
