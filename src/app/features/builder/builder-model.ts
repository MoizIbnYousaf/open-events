import type { FormVersionDetailDto, SaveFormDraftInput } from '../../../application'
import type {
  ConditionOperator,
  ElementRule,
  FormElement,
  FormPage,
  FormVersionContent,
  QuestionType,
  RoutingRule,
  UtcInstant,
  VersionId,
  VersionNumber,
  VersionStatus,
} from '../../../domain'

export interface BuilderDraftMeta {
  readonly formId: string
  readonly eventId: string
  readonly versionId: VersionId
  readonly version: VersionNumber
  readonly status: VersionStatus
  readonly contentHash: string | null
  readonly publishedAt: UtcInstant | null
  readonly updatedAt: UtcInstant
}

export interface BuilderDraft {
  readonly meta: BuilderDraftMeta
  readonly content: FormVersionContent
}

export type BuilderValidationIssue =
  | { readonly kind: 'label'; readonly elementId: string }
  | {
      readonly kind: 'condition-value'
      readonly ruleId: string
      readonly groupIndex: number
      readonly conditionIndex: number
    }

const VALUE_REQUIRED_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  'eq',
  'ne',
  'gt',
  'lt',
  'contains',
])

const OPERATOR_OPTIONS: Record<QuestionType, readonly ConditionOperator[]> = {
  short_text: ['eq', 'ne', 'contains', 'empty', 'not-empty'],
  long_text: ['eq', 'ne', 'contains', 'empty', 'not-empty'],
  email: ['eq', 'ne', 'contains', 'empty', 'not-empty'],
  number: ['eq', 'ne', 'gt', 'lt', 'empty', 'not-empty'],
  single_choice: ['eq', 'ne', 'empty', 'not-empty'],
  multi_choice: ['eq', 'ne', 'empty', 'not-empty'],
}

export function operatorOptionsFor(
  questionType: QuestionType | null,
): readonly ConditionOperator[] {
  return questionType === null ? ['eq', 'ne', 'empty', 'not-empty'] : OPERATOR_OPTIONS[questionType]
}

export function conditionValueKey(
  ruleId: string,
  groupIndex: number,
  conditionIndex: number,
): string {
  return `${ruleId}:${groupIndex}:${conditionIndex}`
}

/** Loads a draft DTO into the domain-shaped editor model with elements grouped by page. */
export function dtoToBuilderDraft(dto: FormVersionDetailDto): BuilderDraft {
  const { eventId, versionId } = dto
  const pages: FormPage[] = dto.pages.map((page) => ({
    id: page.id,
    eventId,
    versionId,
    position: page.position,
    kind: page.kind,
    title: page.title,
    content: page.content,
  }))
  const pageOrder = new Map(pages.map((page, index) => [page.id, index] as const))
  const elements: FormElement[] = [...dto.elements]
    .map((element) => ({
      id: element.id,
      eventId,
      versionId,
      pageId: element.pageId,
      position: element.position,
      kind: element.kind,
      fieldKey: element.fieldKey,
      label: element.label,
      required: element.required,
      maxLength: element.maxLength,
      questionType: element.questionType,
      options: element.options,
      // The builder edits literal lists. A question that takes the event's
      // vocabulary is resolved when the form is READ, so the editor has no
      // source of its own to carry.
      optionsSource: null,
    }))
    .sort(
      (a, b) =>
        (pageOrder.get(a.pageId) ?? Number.MAX_SAFE_INTEGER) -
        (pageOrder.get(b.pageId) ?? Number.MAX_SAFE_INTEGER),
    )
  const conditionRules: ElementRule[] = dto.conditionRules.map((rule) => ({
    id: rule.id,
    eventId,
    versionId,
    elementId: rule.elementId,
    effect: rule.effect,
    groups: rule.groups.map((group) => ({
      groupIndex: group.groupIndex,
      conditions: group.conditions,
    })),
    position: rule.position,
  }))
  const routingRules: RoutingRule[] = dto.routingRules.map((rule) => ({
    id: rule.id,
    eventId,
    versionId,
    position: rule.position,
    condition: { groups: rule.condition.groups },
    actionKind: rule.actionKind,
    actionTarget: rule.actionTarget,
  }))
  return {
    meta: {
      formId: dto.formId,
      eventId,
      versionId,
      version: dto.version,
      status: dto.status,
      contentHash: dto.contentHash,
      publishedAt: dto.publishedAt,
      updatedAt: dto.updatedAt,
    },
    content: { pages, elements, conditionRules, routingRules },
  }
}

/**
 * Split the one-per-line choices field on newlines only. The live textarea
 * never calls this — it keeps the raw string — so a space in "Option 1" cannot
 * be eaten on the way through. Commit (blur) is the only caller.
 */
export function choicesTextToOptions(text: string): readonly string[] {
  return text.split('\n')
}

/** Drop blank choice rows before a draft is written. */
export function compactChoiceOptions(options: readonly string[]): readonly string[] {
  return options.map((line) => line.trim()).filter((line) => line.length > 0)
}

/** Full-replace save body: the domain-shaped content exactly. */
export function toSaveInput(draft: BuilderDraft): SaveFormDraftInput {
  return {
    pages: draft.content.pages,
    elements: draft.content.elements.map((element) => ({
      ...element,
      options: compactChoiceOptions(element.options),
    })),
    conditionRules: draft.content.conditionRules,
    routingRules: draft.content.routingRules,
  }
}

/**
 * Rebuilds the editor model from a save response. The server reissues every
 * page/element/rule id; page references are remapped by request order so no
 * stale client id survives into the next save.
 */
export function rebindDraft(
  response: FormVersionDetailDto,
  request: SaveFormDraftInput,
): BuilderDraft {
  const { eventId, versionId } = response
  const pageIdMap = new Map<string, string>()
  request.pages.forEach((page, index) => {
    const reissued = response.pages[index]
    if (reissued !== undefined) pageIdMap.set(page.id, reissued.id)
  })
  const pages: FormPage[] = response.pages.map((page) => ({
    id: page.id,
    eventId,
    versionId,
    position: page.position,
    kind: page.kind,
    title: page.title,
    content: page.content,
  }))
  const pageOrder = new Map(pages.map((page, index) => [page.id, index] as const))
  const elements: FormElement[] = response.elements
    .map((element, index) => {
      const sourcePageId = request.elements[index]?.pageId ?? element.pageId
      return {
        id: element.id,
        eventId,
        versionId,
        pageId: pageIdMap.get(sourcePageId) ?? element.pageId,
        position: element.position,
        kind: element.kind,
        fieldKey: element.fieldKey,
        label: element.label,
        required: element.required,
        maxLength: element.maxLength,
        questionType: element.questionType,
        options: element.options,
        optionsSource: null,
      }
    })
    .sort(
      (a, b) =>
        (pageOrder.get(a.pageId) ?? Number.MAX_SAFE_INTEGER) -
        (pageOrder.get(b.pageId) ?? Number.MAX_SAFE_INTEGER),
    )
  const conditionRules: ElementRule[] = response.conditionRules.map((rule) => ({
    id: rule.id,
    eventId,
    versionId,
    elementId: rule.elementId,
    effect: rule.effect,
    groups: rule.groups.map((group) => ({
      groupIndex: group.groupIndex,
      conditions: group.conditions,
    })),
    position: rule.position,
  }))
  const routingRules: RoutingRule[] = response.routingRules.map((rule) => ({
    id: rule.id,
    eventId,
    versionId,
    position: rule.position,
    condition: { groups: rule.condition.groups },
    actionKind: rule.actionKind,
    actionTarget: rule.actionTarget,
  }))
  return {
    meta: {
      formId: response.formId,
      eventId,
      versionId,
      version: response.version,
      status: response.status,
      contentHash: response.contentHash,
      publishedAt: response.publishedAt,
      updatedAt: response.updatedAt,
    },
    content: { pages, elements, conditionRules, routingRules },
  }
}

/**
 * Appends a question the organizer can then label, type, and (for a dropdown)
 * give options. The builder used to be a rearrange-only surface: every field
 * had to already exist on the published form, so an organizer could not add
 * "Key takeaway" or "Audience level" from scratch.
 */
export function addQuestionToDraft(
  draft: BuilderDraft,
  pageId: string | null,
  questionType: QuestionType,
): BuilderDraft {
  let pages = draft.content.pages
  let targetPageId = pageId
  if (pages.length === 0) {
    const page: FormPage = {
      id: crypto.randomUUID(),
      eventId: draft.meta.eventId,
      versionId: draft.meta.versionId,
      position: 0,
      kind: 'info',
      title: 'Proposal',
      content: '',
    }
    pages = [page]
    targetPageId = page.id
  } else if (targetPageId === null) {
    targetPageId = pages[0]?.id ?? null
  }
  if (targetPageId === null) return draft
  const used = new Set(
    draft.content.elements
      .map((element) => element.fieldKey)
      .filter((key): key is string => key !== null && key !== ''),
  )
  let index = 1
  let fieldKey = `custom_question_${index}`
  while (used.has(fieldKey)) {
    index += 1
    fieldKey = `custom_question_${index}`
  }
  const position = draft.content.elements.filter((element) => element.pageId === targetPageId).length
  const isChoice = questionType === 'single_choice' || questionType === 'multi_choice'
  const element: FormElement = {
    id: crypto.randomUUID(),
    eventId: draft.meta.eventId,
    versionId: draft.meta.versionId,
    pageId: targetPageId,
    position,
    kind: 'question',
    fieldKey,
    label: 'New question',
    required: false,
    maxLength: questionType === 'long_text' ? 4000 : 200,
    questionType,
    options: isChoice ? ['Option 1'] : [],
    optionsSource: null,
  }
  return {
    ...draft,
    content: {
      ...draft.content,
      pages,
      elements: [...draft.content.elements, element],
    },
  }
}

/** Moves an element within its page group; returns the new 0-based page index. */
export function moveElementInDraft(
  draft: BuilderDraft,
  elementId: string,
  direction: 'up' | 'down',
): { readonly draft: BuilderDraft; readonly moved: boolean; readonly pageIndex: number } {
  const elements = [...draft.content.elements]
  const index = elements.findIndex((element) => element.id === elementId)
  if (index < 0) return { draft, moved: false, pageIndex: -1 }
  const pageId = elements[index]?.pageId
  if (pageId === undefined) return { draft, moved: false, pageIndex: -1 }
  const step = direction === 'up' ? -1 : 1
  let target = index + step
  while (target >= 0 && target < elements.length && elements[target]?.pageId !== pageId) {
    target += step
  }
  if (target < 0 || target >= elements.length || elements[target]?.pageId !== pageId) {
    return { draft, moved: false, pageIndex: -1 }
  }
  const current = elements[index]
  const neighbor = elements[target]
  if (current === undefined || neighbor === undefined) return { draft, moved: false, pageIndex: -1 }
  elements[index] = { ...neighbor, position: current.position }
  elements[target] = { ...current, position: neighbor.position }
  const pageIndex =
    elements.slice(0, target + 1).filter((element) => element.pageId === pageId).length - 1
  return {
    draft: { ...draft, content: { ...draft.content, elements } },
    moved: true,
    pageIndex,
  }
}

/** First invalid field: an empty element label or an empty required condition value. */
export function validateBuilderContent(content: FormVersionContent): BuilderValidationIssue | null {
  for (const element of content.elements) {
    if (
      (element.kind === 'field' || element.kind === 'question') &&
      (element.label ?? '').trim().length === 0
    ) {
      return { kind: 'label', elementId: element.id }
    }
  }
  for (const rule of content.conditionRules) {
    for (const group of rule.groups) {
      for (const [conditionIndex, condition] of group.conditions.entries()) {
        if (
          VALUE_REQUIRED_OPERATORS.has(condition.operator) &&
          (condition.value === null || condition.value === '')
        ) {
          return {
            kind: 'condition-value',
            ruleId: rule.id,
            groupIndex: group.groupIndex,
            conditionIndex,
          }
        }
      }
    }
  }
  return null
}
