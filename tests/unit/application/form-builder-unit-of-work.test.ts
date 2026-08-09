import { describe, expect, it } from 'vitest'

import {
  FormBuilderService,
  type FormBuilderUnitOfWork,
  type PublishResult,
  type SaveDraftResult,
  type SaveFormDraftInput,
} from '../../../src/application'
import type { CfpForm, FormVersion, FormVersionContent } from '../../../src/domain'
import {
  EVENT_ID,
  FIXED_NOW,
  FORM_ID,
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
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

class RecordingFormBuilderUnitOfWork implements FormBuilderUnitOfWork {
  readonly saveDraftCalls: Array<{
    readonly expected: FormVersion | null
    readonly version: FormVersion
    readonly content: FormVersionContent
  }> = []
  readonly publishCalls: Array<{
    readonly expected: FormVersion
    readonly publishedVersion: FormVersion
    readonly expectedForm: CfpForm
    readonly form: CfpForm
  }> = []
  saveDraftResult: SaveDraftResult = { outcome: 'saved' }
  publishResult: PublishResult = { outcome: 'published' }

  async saveDraft(input: {
    readonly expected: FormVersion | null
    readonly version: FormVersion
    readonly content: FormVersionContent
  }): Promise<SaveDraftResult> {
    this.saveDraftCalls.push(input)
    return this.saveDraftResult
  }

  async publish(input: {
    readonly expected: FormVersion
    readonly publishedVersion: FormVersion
    readonly expectedForm: CfpForm
    readonly form: CfpForm
  }): Promise<PublishResult> {
    this.publishCalls.push(input)
    return this.publishResult
  }
}

function buildHarness() {
  const events = new InMemoryEventRepository([eventFixture])
  const forms = new InMemoryFormRepository([createForm()])
  const versions = new InMemoryFormVersionRepository()
  const content = new InMemoryFormContentRepository()
  const taxonomies = new InMemoryTaxonomyRepository([[EVENT_ID, [createTaxonomyItem()]]])
  const unitOfWork = new RecordingFormBuilderUnitOfWork()
  const service = new FormBuilderService(events, forms, versions, content, taxonomies, unitOfWork, {
    now: () => FIXED_NOW,
  })
  return { service, unitOfWork, forms, versions, content }
}

function draftInput(): SaveFormDraftInput {
  const content = createContent()
  return {
    pages: content.pages,
    elements: content.elements,
    conditionRules: content.conditionRules,
    routingRules: content.routingRules,
  }
}

describe('FormBuilderService atomic unit-of-work', () => {
  it('saves the draft version and content in one port call with a null expected stamp', async () => {
    const { service, unitOfWork, versions, content } = buildHarness()

    const detail = await service.updateDraft(organizerActor, FORM_ID, draftInput())

    expect(unitOfWork.saveDraftCalls).toHaveLength(1)
    const call = unitOfWork.saveDraftCalls[0]
    expect(call?.expected).toBeNull()
    expect(call?.version.id).toBe(detail.versionId)
    expect(call?.version.status).toBe('draft')
    expect(call?.version.updatedAt).toBe(FIXED_NOW)
    expect(call?.content.elements.map((element) => element.fieldKey)).toContain('format')
    expect(await versions.listByForm(FORM_ID)).toEqual([])
    expect(await content.loadByVersion(EVENT_ID, call?.version.id ?? 'none')).toEqual({
      pages: [],
      elements: [],
      conditionRules: [],
      routingRules: [],
    })
  })

  it('passes the expected draft stamp when saving an existing draft', async () => {
    const { service, unitOfWork, versions } = buildHarness()
    const first = await service.updateDraft(organizerActor, FORM_ID, draftInput())
    await versions.save(createVersion({ id: first.versionId, version: 1, updatedAt: FIXED_NOW }))
    unitOfWork.saveDraftCalls.length = 0

    await service.updateDraft(organizerActor, FORM_ID, draftInput())

    expect(unitOfWork.saveDraftCalls).toHaveLength(1)
    expect(unitOfWork.saveDraftCalls[0]?.expected?.id).toBe(first.versionId)
    expect(unitOfWork.saveDraftCalls[0]?.expected?.updatedAt).toBe(FIXED_NOW)
  })

  it('maps a stale saveDraft conflict to a typed ApplicationError', async () => {
    const { service, unitOfWork } = buildHarness()
    unitOfWork.saveDraftResult = { outcome: 'conflict' }

    await expect(service.updateDraft(organizerActor, FORM_ID, draftInput())).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(unitOfWork.saveDraftCalls).toHaveLength(1)
  })

  it('does not call the port when the draft fails validation', async () => {
    const { service, unitOfWork } = buildHarness()
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

    await expect(service.updateDraft(organizerActor, FORM_ID, badInput)).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(unitOfWork.saveDraftCalls).toEqual([])
  })

  it('publishes the frozen version and form pointer in one port call', async () => {
    const { service, unitOfWork, versions, forms, content } = buildHarness()
    const draft = createVersion({ id: 'version-draft-1' })
    await versions.save(draft)
    await content.saveForVersion(EVENT_ID, draft.id, createContent())

    await service.publish(organizerActor, FORM_ID)

    expect(unitOfWork.publishCalls).toHaveLength(1)
    const call = unitOfWork.publishCalls[0]
    expect(call?.expected.id).toBe(draft.id)
    expect(call?.publishedVersion.status).toBe('published')
    expect(call?.publishedVersion.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(call?.expectedForm.publishedVersionId).toBeNull()
    expect(call?.form.publishedVersionId).toBe(draft.id)
    expect(call?.form.status).toBe('published')
    expect((await versions.listByForm(FORM_ID))[0]?.status).toBe('draft')
    expect((await forms.findById(FORM_ID))?.status).toBe('draft')
  })

  it('maps a stale publish conflict to a typed ApplicationError', async () => {
    const { service, unitOfWork, versions, content } = buildHarness()
    const draft = createVersion({ id: 'version-draft-1' })
    await versions.save(draft)
    await content.saveForVersion(EVENT_ID, draft.id, createContent())
    unitOfWork.publishResult = { outcome: 'conflict' }

    await expect(service.publish(organizerActor, FORM_ID)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(unitOfWork.publishCalls).toHaveLength(1)
  })

  it('does not call the publish port for invalid rules or a missing draft', async () => {
    const invalid = buildHarness()
    const draft = await invalid.service.updateDraft(organizerActor, FORM_ID, draftInput())
    await invalid.versions.save(createVersion({ id: draft.versionId }))
    const badContent = createContent({
      routingRules: [
        {
          ...createContent().routingRules[0]!,
          actionKind: 'assign_tag',
          actionTarget: 'unknown-tag',
        },
      ],
    })
    await invalid.content.saveForVersion(EVENT_ID, draft.versionId, badContent)

    await expect(invalid.service.publish(organizerActor, FORM_ID)).rejects.toMatchObject({
      code: 'validation_failed',
    })
    expect(invalid.unitOfWork.publishCalls).toEqual([])

    const empty = buildHarness()
    await expect(empty.service.publish(organizerActor, FORM_ID)).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(empty.unitOfWork.publishCalls).toEqual([])
  })
})
