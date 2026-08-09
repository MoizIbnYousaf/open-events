import type {
  CfpForm,
  ElementRule,
  EventId,
  EventSlug,
  FormElement,
  FormId,
  FormPage,
  FormSlug,
  FormVersion,
  FormVersionContent,
  RoutingRule,
  VersionId,
} from '../../domain'
import {
  computeFormVersionContentHash,
  nextVersionNumber,
  validateVersionFreeze,
  validateVersionRules,
} from '../../domain'
import type { OrganizerActor } from '../actors'
import type {
  FormDefinitionDto,
  FormSummaryDto,
  FormVersionDetailDto,
  FormVersionSummaryDto,
  SaveFormDraftInput,
} from '../dtos/form-definition.dto'
import {
  toFormDefinitionDto,
  toFormSummaryDto,
  toFormVersionDetailDto,
  toFormVersionSummaryDto,
} from '../dtos/form-definition.dto'
import { ApplicationError, ValidationFailedError } from '../errors'
import type { Clock } from '../ports/clock'
import type { EventRepository } from '../ports/event-repository'
import type { FormBuilderUnitOfWork } from '../ports/form-builder-unit-of-work'
import type { FormContentRepository } from '../ports/form-content-repository'
import type { FormRepository } from '../ports/form-repository'
import type { FormVersionRepository } from '../ports/form-version-repository'
import type { TaxonomyRepository } from '../ports/taxonomy-repository'

export class FormBuilderService {
  readonly #events: EventRepository
  readonly #forms: FormRepository
  readonly #versions: FormVersionRepository
  readonly #content: FormContentRepository
  readonly #taxonomies: TaxonomyRepository
  readonly #unitOfWork: FormBuilderUnitOfWork
  readonly #clock: Clock

  constructor(
    events: EventRepository,
    forms: FormRepository,
    versions: FormVersionRepository,
    content: FormContentRepository,
    taxonomies: TaxonomyRepository,
    unitOfWork: FormBuilderUnitOfWork,
    clock: Clock,
  ) {
    this.#events = events
    this.#forms = forms
    this.#versions = versions
    this.#content = content
    this.#taxonomies = taxonomies
    this.#unitOfWork = unitOfWork
    this.#clock = clock
  }

  async getDraft(_actor: OrganizerActor, formId: FormId): Promise<FormVersionDetailDto | null> {
    const version = await this.#versions.findLatestDraftByForm(formId)
    if (version === null) return null
    const content = await this.#content.loadByVersion(version.eventId, version.id)
    return toFormVersionDetailDto(version, content)
  }

  async listVersions(
    _actor: OrganizerActor,
    formId: FormId,
  ): Promise<readonly FormVersionSummaryDto[]> {
    const versions = await this.#versions.listByForm(formId)
    return versions.map(toFormVersionSummaryDto)
  }

  /** Form discovery for the admin builder (`GET /api/admin/events/:slug/forms`). */
  async listByEvent(_actor: OrganizerActor, eventId: EventId): Promise<readonly FormSummaryDto[]> {
    const forms = await this.#forms.listByEvent(eventId)
    return forms.map(toFormSummaryDto)
  }

  /** Immutable detail of any version that belongs to the form (safe null on mismatch). */
  async getVersionDetail(
    _actor: OrganizerActor,
    formId: FormId,
    versionId: VersionId,
  ): Promise<FormVersionDetailDto | null> {
    const version = await this.#versions.findById(versionId)
    if (version === null || version.formId !== formId) return null
    const content = await this.#content.loadByVersion(version.eventId, version.id)
    return toFormVersionDetailDto(version, content)
  }

  /**
   * Replaces the form's draft version content. Editing a published form forks a
   * new draft version (next number) without mutating the frozen published
   * rows; row ids in the response are server-generated on every save. The
   * unit-of-work enforces an optimistic `updatedAt` precondition, so a
   * concurrent edit surfaces as `conflict` instead of silently clobbering.
   */
  async updateDraft(
    _actor: OrganizerActor,
    formId: FormId,
    input: SaveFormDraftInput,
  ): Promise<FormVersionDetailDto> {
    const form = await this.#requireForm(formId)
    const allVersions = await this.#versions.listByForm(formId)
    const expected = latestDraftVersion(allVersions)
    const now = this.#clock.now()
    const version: FormVersion =
      expected === null
        ? {
            id: crypto.randomUUID(),
            eventId: form.eventId,
            formId: form.id,
            version: nextVersionNumber(allVersions),
            status: 'draft',
            contentHash: null,
            publishedAt: null,
            updatedAt: now,
          }
        : { ...expected, updatedAt: now }
    const content = reissueContentIds(version, input)
    const issues = validateVersionRules(content, await this.#taxonomyReference(form.eventId))
    if (issues.length > 0) {
      throw new ValidationFailedError(`Draft version '${version.id}' has invalid rules`, issues)
    }
    const result = await this.#unitOfWork.saveDraft({ expected, version, content })
    if (result.outcome === 'conflict') {
      throw new ApplicationError(
        'conflict',
        `Draft version '${version.id}' was modified concurrently`,
      )
    }
    return toFormVersionDetailDto(version, content)
  }

  /** Publish = validate, freeze (content hash + published_at), and bind the form. */
  async publish(_actor: OrganizerActor, formId: FormId): Promise<FormVersionDetailDto> {
    const form = await this.#requireForm(formId)
    const expected = await this.#versions.findLatestDraftByForm(formId)
    if (expected === null) {
      throw new ApplicationError('conflict', `Form '${formId}' has no draft version to publish`)
    }
    const content = await this.#content.loadByVersion(form.eventId, expected.id)
    const issues = validateVersionRules(content, await this.#taxonomyReference(form.eventId))
    if (issues.length > 0) {
      throw new ValidationFailedError(
        `Version '${expected.id}' cannot be published with invalid rules`,
        issues,
      )
    }
    const freezeIssues = validateVersionFreeze(expected)
    if (freezeIssues.length > 0) {
      throw new ValidationFailedError(`Version '${expected.id}' cannot be frozen`, freezeIssues)
    }
    const now = this.#clock.now()
    const contentHash = await computeFormVersionContentHash(content)
    const published: FormVersion = {
      ...expected,
      status: 'published',
      contentHash,
      publishedAt: now,
      updatedAt: now,
    }
    const updatedForm: CfpForm = { ...form, status: 'published', publishedVersionId: published.id }
    const result = await this.#unitOfWork.publish({
      expected,
      publishedVersion: published,
      expectedForm: form,
      form: updatedForm,
    })
    if (result.outcome === 'conflict') {
      throw new ApplicationError('conflict', `Version '${expected.id}' was published concurrently`)
    }
    return toFormVersionDetailDto(published, content)
  }

  /**
   * Single event-slug public entry: resolves the event's published form. M2
   * seeds exactly one published form per event; multiple published forms must
   * be addressed by the two-segment `getPublishedByEventSlug` route.
   */
  async getPublishedByEvent(eventSlug: EventSlug): Promise<FormDefinitionDto | null> {
    const event = await this.#events.findBySlug(eventSlug)
    if (event === null) return null
    const forms = await this.#forms.listByEvent(event.id)
    const publishedForms = forms.filter((form) => form.publishedVersionId !== null)
    if (publishedForms.length === 0) return null
    const form = publishedForms[0]
    if (form === undefined || form.publishedVersionId === null) return null
    if (publishedForms.length > 1) {
      throw new ApplicationError(
        'conflict',
        `Event '${eventSlug}' has multiple published forms; address one by form slug`,
      )
    }
    const version = await this.#versions.findById(form.publishedVersionId)
    if (version === null || version.status !== 'published') return null
    const content = await this.#content.loadByVersion(form.eventId, version.id)
    return toFormDefinitionDto(form, event.slug, version, content)
  }

  /** Unambiguous public addressing: event slug + form slug. */
  async getPublishedByEventSlug(
    eventSlug: EventSlug,
    formSlug: FormSlug,
  ): Promise<FormDefinitionDto | null> {
    const event = await this.#events.findBySlug(eventSlug)
    if (event === null) return null
    const form = await this.#forms.findByEventAndSlug(event.id, formSlug)
    if (form === null || form.publishedVersionId === null) return null
    const version = await this.#versions.findById(form.publishedVersionId)
    if (version === null || version.status !== 'published') return null
    const content = await this.#content.loadByVersion(form.eventId, version.id)
    return toFormDefinitionDto(form, event.slug, version, content)
  }

  async #taxonomyReference(eventId: EventId) {
    const items = await this.#taxonomies.listByEvent(eventId)
    return new Map(items.map((item) => [item.key, item.kind]))
  }

  async #requireForm(formId: FormId): Promise<CfpForm> {
    const form = await this.#forms.findById(formId)
    if (form === null) {
      throw new ApplicationError('not_found', `Form '${formId}' not found`)
    }
    return form
  }
}

function latestDraftVersion(versions: readonly FormVersion[]): FormVersion | null {
  const drafts = versions.filter((version) => version.status === 'draft')
  if (drafts.length === 0) return null
  return drafts.reduce((latest, version) => (version.version > latest.version ? version : latest))
}

function reissueContentIds(version: FormVersion, input: SaveFormDraftInput): FormVersionContent {
  const pageIds = new Map<string, string>()
  const elementIds = new Map<string, string>()
  const pages: FormPage[] = input.pages.map((page) => {
    const id = crypto.randomUUID()
    pageIds.set(page.id, id)
    return { ...page, id, eventId: version.eventId, versionId: version.id }
  })
  const elements: FormElement[] = input.elements.map((element) => {
    const id = crypto.randomUUID()
    elementIds.set(element.id, id)
    return {
      ...element,
      id,
      eventId: version.eventId,
      versionId: version.id,
      pageId: pageIds.get(element.pageId) ?? element.pageId,
    }
  })
  const conditionRules: ElementRule[] = input.conditionRules.map((rule) => ({
    ...rule,
    id: crypto.randomUUID(),
    eventId: version.eventId,
    versionId: version.id,
    elementId: elementIds.get(rule.elementId) ?? rule.elementId,
  }))
  const routingRules: RoutingRule[] = input.routingRules.map((rule) => ({
    ...rule,
    id: crypto.randomUUID(),
    eventId: version.eventId,
    versionId: version.id,
  }))
  return { pages, elements, conditionRules, routingRules }
}
