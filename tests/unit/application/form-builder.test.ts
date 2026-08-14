import { describe, expect, it } from 'vitest'

import { FormBuilderService, type SaveFormDraftInput } from '../../../src/application'
import { ValidationFailedError } from '../../../src/application'
import {
  EVENT_ID,
  EVENT_SLUG,
  FIXED_NOW,
  FORM_ID,
  NOW,
  createContent,
  createForm,
  createTaxonomyItem,
  createVersion,
  eventFixture,
  organizerActor,
} from '../helpers/fixtures'
import {
  InMemoryEventRepository,
  InMemoryFormContentRepository,
  InMemoryFormRepository,
  InMemoryFormVersionRepository,
  InMemoryTaxonomyRepository,
} from '../helpers/in-memory-repositories'
import { InMemoryFormBuilderUnitOfWork } from '../helpers/in-memory-unit-of-work'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

function buildHarness(forms: readonly ReturnType<typeof createForm>[] = [createForm()]) {
  const events = new InMemoryEventRepository([eventFixture])
  const formsRepo = new InMemoryFormRepository(forms)
  const versions = new InMemoryFormVersionRepository()
  const content = new InMemoryFormContentRepository()
  const taxonomies = new InMemoryTaxonomyRepository([[EVENT_ID, [createTaxonomyItem()]]])
  const unitOfWork = new InMemoryFormBuilderUnitOfWork({
    versions,
    content,
    forms: formsRepo,
  })
  const service = new FormBuilderService(
    events,
    formsRepo,
    versions,
    content,
    taxonomies,
    unitOfWork,
    { now: () => FIXED_NOW },
  )
  return { service, forms: formsRepo, versions, content, taxonomies, unitOfWork }
}

function draftInput(overrides: Partial<SaveFormDraftInput> = {}): SaveFormDraftInput {
  const content = createContent()
  return {
    pages: content.pages,
    elements: content.elements,
    conditionRules: content.conditionRules,
    routingRules: content.routingRules,
    ...overrides,
  }
}

describe('FormBuilderService.updateDraft', () => {
  it('creates draft version 1 and persists the content through the unit of work', async () => {
    const { service, versions, content } = buildHarness()

    const detail = await service.updateDraft(organizerActor, EVENT_ID, FORM_ID, draftInput())

    expect(detail.formId).toBe(FORM_ID)
    expect(detail.version).toBe(1)
    expect(detail.status).toBe('draft')
    expect(detail.contentHash).toBeNull()
    expect(detail.updatedAt).toBe(FIXED_NOW)
    expect(detail.pages).toHaveLength(1)
    expect(detail.elements).toHaveLength(6)
    expect(detail.routingRules).toHaveLength(1)

    const saved = (await versions.listByForm(FORM_ID))[0]
    expect(saved?.status).toBe('draft')
    const savedContent = await content.loadByVersion(EVENT_ID, detail.versionId)
    expect(savedContent.elements.map((element) => element.fieldKey)).toContain('format')
  })

  it('rejects invalid rules and persists nothing', async () => {
    const { service, versions, content } = buildHarness()
    const badInput: SaveFormDraftInput = {
      ...draftInput(),
      conditionRules: [
        {
          ...createContent().conditionRules[0]!,
          groups: [
            { groupIndex: 0, conditions: [{ operator: 'eq', operandKey: 'ghost', value: 'x' }] },
          ],
        },
      ],
    }

    await expect(
      service.updateDraft(organizerActor, EVENT_ID, FORM_ID, badInput),
    ).rejects.toBeInstanceOf(ValidationFailedError)
    expect(await versions.listByForm(FORM_ID)).toEqual([])
    expect(await content.loadByVersion(EVENT_ID, 'version-1')).toEqual({
      pages: [],
      elements: [],
      conditionRules: [],
      routingRules: [],
    })
  })
})

describe('FormBuilderService.publish', () => {
  it('freezes the draft with a content hash and binds the form', async () => {
    const { service, forms, versions } = buildHarness()
    const draft = await service.updateDraft(organizerActor, EVENT_ID, FORM_ID, draftInput())

    const published = await service.publish(organizerActor, EVENT_ID, FORM_ID)

    expect(published.status).toBe('published')
    expect(published.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(published.publishedAt).toBe(FIXED_NOW)
    expect(published.updatedAt).toBe(FIXED_NOW)
    const savedVersion = (await versions.listByForm(FORM_ID))[0]
    expect(savedVersion?.status).toBe('published')
    expect((await forms.findById(FORM_ID))?.status).toBe('published')
    expect((await forms.findById(FORM_ID))?.publishedVersionId).toBe(draft.versionId)
  })

  it('refuses to publish a version with invalid rules', async () => {
    const { service, versions, content } = buildHarness()
    const draft = await service.updateDraft(organizerActor, EVENT_ID, FORM_ID, draftInput())
    await content.saveForVersion(
      EVENT_ID,
      draft.versionId,
      createContent({
        routingRules: [
          {
            ...createContent().routingRules[0]!,
            actionKind: 'assign_tag',
            actionTarget: 'unknown-tag',
          },
        ],
      }),
    )

    await expect(service.publish(organizerActor, EVENT_ID, FORM_ID)).rejects.toBeInstanceOf(
      ValidationFailedError,
    )
    const version = (await versions.listByForm(FORM_ID))[0]
    expect(version?.status).toBe('draft')
    expect(version?.contentHash).toBeNull()
  })

  it('refuses to publish when there is no draft version', async () => {
    const { service } = buildHarness()

    await expect(service.publish(organizerActor, EVENT_ID, FORM_ID)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('forks a new draft version when editing a published form', async () => {
    const { service, versions } = buildHarness()
    await service.updateDraft(organizerActor, EVENT_ID, FORM_ID, draftInput())
    const published = await service.publish(organizerActor, EVENT_ID, FORM_ID)

    const nextDraft = await service.updateDraft(organizerActor, EVENT_ID, FORM_ID, draftInput())

    expect(nextDraft.version).toBe(2)
    expect(nextDraft.status).toBe('draft')
    expect(nextDraft.versionId).not.toBe(published.versionId)
    const allVersions = await versions.listByForm(FORM_ID)
    expect(allVersions.map((version) => version.version)).toEqual([1, 2])
    const frozen = allVersions.find((version) => version.version === 1)
    expect(frozen?.status).toBe('published')
    expect(frozen?.contentHash).toBe(published.contentHash)
  })
})

describe('FormBuilderService P0 contracts', () => {
  it('lists only this event form summaries', async () => {
    const { service } = buildHarness([
      createForm(),
      createForm({ id: 'form-other-event', eventId: 'event-other' }),
    ])

    const summaries = await service.listByEvent(organizerActor, EVENT_ID)

    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toEqual({
      formId: FORM_ID,
      eventId: EVENT_ID,
      slug: 'cfp',
      status: 'draft',
      publishedVersionId: null,
      opensAt: null,
      closesAt: null,
    })
    expect(await service.listByEvent(organizerActor, 'event-unknown')).toEqual([])
  })

  it('returns version detail for any version of the form and null otherwise', async () => {
    const { service, versions, content } = buildHarness()
    const draft = await service.updateDraft(organizerActor, EVENT_ID, FORM_ID, draftInput())
    await service.publish(organizerActor, EVENT_ID, FORM_ID)
    const versionTwo = createVersion({ id: 'version-2', version: 2, updatedAt: FIXED_NOW })
    await versions.save(versionTwo)
    await content.saveForVersion(EVENT_ID, versionTwo.id, createContent())

    expect(
      await service.getVersionDetail(organizerActor, EVENT_ID, FORM_ID, draft.versionId),
    ).toMatchObject({
      versionId: draft.versionId,
      status: 'published',
    })
    expect(
      await service.getVersionDetail(organizerActor, EVENT_ID, FORM_ID, 'version-2'),
    ).toMatchObject({
      versionId: 'version-2',
      status: 'draft',
    })
    expect(
      await service.getVersionDetail(organizerActor, EVENT_ID, FORM_ID, 'version-ghost'),
    ).toBeNull()
    // O3: an unknown/other form under this event now throws the same safe
    // not_found as a cross-event form instead of answering null.
    await expect(
      service.getVersionDetail(organizerActor, EVENT_ID, 'form-other', draft.versionId),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('exposes the eventSlug on public definitions', async () => {
    const { service } = buildHarness()
    await service.updateDraft(organizerActor, EVENT_ID, FORM_ID, draftInput())
    await service.publish(organizerActor, EVENT_ID, FORM_ID)

    const definition = await service.getPublishedByEventSlug(EVENT_SLUG, 'cfp')
    expect(definition?.eventSlug).toBe(EVENT_SLUG)
    expect(definition?.formSlug).toBe('cfp')
    expect(await service.getPublishedByEventSlug('unknown-event', 'cfp')).toBeNull()
    expect(await service.getPublishedByEventSlug(EVENT_SLUG, 'unknown-form')).toBeNull()
  })

  it('resolves the single published form by event slug', async () => {
    const { service } = buildHarness()
    await service.updateDraft(organizerActor, EVENT_ID, FORM_ID, draftInput())
    await service.publish(organizerActor, EVENT_ID, FORM_ID)

    const definition = await service.getPublishedByEvent(EVENT_SLUG)
    expect(definition?.eventSlug).toBe(EVENT_SLUG)
    expect(definition?.formSlug).toBe('cfp')
    expect(await service.getPublishedByEvent('unknown-event')).toBeNull()
  })

  it('throws conflict when an event has multiple published forms', async () => {
    const publishedForm = createForm({
      id: 'form-second',
      slug: 'cfp-2',
      status: 'published',
      publishedVersionId: 'version-published-2',
    })
    const { service, versions, content } = buildHarness([
      createForm({ status: 'published', publishedVersionId: 'version-published-1' }),
      publishedForm,
    ])
    await versions.save(
      createVersion({
        id: 'version-published-1',
        status: 'published',
        contentHash: 'h',
        publishedAt: NOW,
      }),
    )
    await versions.save(
      createVersion({
        id: 'version-published-2',
        status: 'published',
        contentHash: 'h',
        publishedAt: NOW,
      }),
    )
    await content.saveForVersion(EVENT_ID, 'version-published-1', createContent())
    await content.saveForVersion(EVENT_ID, 'version-published-2', createContent())

    await expect(service.getPublishedByEvent(EVENT_SLUG)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect((await service.getPublishedByEventSlug(EVENT_SLUG, 'cfp-2'))?.formId).toBe('form-second')
  })
})

describe('FormBuilderService errors and DTO shape', () => {
  it('throws a typed not_found error for unknown forms', async () => {
    const { service } = buildHarness()

    await expect(
      service.updateDraft(organizerActor, EVENT_ID, 'form-ghost', draftInput()),
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
