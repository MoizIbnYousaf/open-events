import type {
  CfpForm,
  ConditionEffect,
  ConditionOperator,
  ConditionValue,
  ElementCondition,
  ElementConditionGroup,
  ElementFieldKey,
  ElementId,
  ElementKind,
  ElementRule,
  EventId,
  EventSlug,
  FormElement,
  FormId,
  FormPage,
  FormSlug,
  FormStatus,
  FormVersion,
  FormVersionContent,
  PageId,
  PageKind,
  QuestionType,
  RoutingActionKind,
  RoutingRule,
  RuleId,
  TaxonomyKey,
  UtcInstant,
  VersionId,
  VersionNumber,
  VersionStatus,
} from '../../domain'
import { submissionStateOf, type SubmissionState } from '../../domain'

export interface FormPageDto {
  readonly id: PageId
  readonly position: number
  readonly kind: PageKind
  readonly title: string
  readonly content: string
}

export interface FormElementDto {
  readonly id: ElementId
  readonly position: number
  readonly pageId: PageId
  readonly kind: ElementKind
  readonly fieldKey: ElementFieldKey | null
  readonly label: string | null
  readonly required: boolean
  readonly maxLength: number | null
  readonly questionType: QuestionType | null
  readonly options: readonly string[]
}

export interface ElementConditionDto {
  readonly operator: ConditionOperator
  readonly operandKey: ElementFieldKey
  readonly value: ConditionValue | null
}

export interface ElementConditionGroupDto {
  readonly groupIndex: number
  readonly conditions: readonly ElementConditionDto[]
}

export interface ElementRuleDto {
  readonly id: RuleId
  readonly elementId: ElementId
  readonly effect: ConditionEffect
  readonly groups: readonly ElementConditionGroupDto[]
  readonly position: number
}

export interface ConditionGroupDto {
  readonly conditions: readonly ElementConditionDto[]
}

export interface ConditionSetDto {
  readonly groups: readonly ConditionGroupDto[]
}

export interface RoutingRuleDto {
  readonly id: RuleId
  readonly position: number
  readonly condition: ConditionSetDto
  readonly actionKind: RoutingActionKind
  readonly actionTarget: TaxonomyKey | null
}

/** Public published CFP definition; routing rules are admin-only. */
export interface FormDefinitionDto {
  readonly formId: FormId
  readonly formSlug: FormSlug
  readonly eventSlug: EventSlug
  readonly versionId: VersionId
  readonly version: VersionNumber
  readonly status: 'published'
  readonly contentHash: string
  readonly publishedAt: UtcInstant
  /**
   * The submission window, as the public portal needs to state it. The window was
   * always enforced on the write path, so a visitor could spend an evening on a
   * proposal and be refused by a date nothing had shown them. Capacity limits
   * stay internal — a cap is the programme's business, a deadline is the
   * submitter's.
   */
  readonly opensAt: UtcInstant | null
  readonly closesAt: UtcInstant | null
  /**
   * The window's verdict, decided by the server. The portal renders a closed call
   * without re-deriving it from a date and a clock it cannot be trusted to share
   * with the submit gate.
   */
  readonly submissionState: SubmissionState
  readonly pages: readonly FormPageDto[]
  readonly elements: readonly FormElementDto[]
  readonly conditionRules: readonly ElementRuleDto[]
}

export interface FormVersionSummaryDto {
  readonly id: VersionId
  readonly formId: FormId
  readonly version: VersionNumber
  readonly status: VersionStatus
  readonly contentHash: string | null
  readonly publishedAt: UtcInstant | null
  readonly updatedAt: UtcInstant
}

/** Admin view of one version including routing rules and freeze metadata. */
export interface FormVersionDetailDto {
  readonly formId: FormId
  readonly eventId: EventId
  readonly versionId: VersionId
  readonly version: VersionNumber
  readonly status: VersionStatus
  readonly contentHash: string | null
  readonly publishedAt: UtcInstant | null
  readonly updatedAt: UtcInstant
  readonly pages: readonly FormPageDto[]
  readonly elements: readonly FormElementDto[]
  readonly conditionRules: readonly ElementRuleDto[]
  readonly routingRules: readonly RoutingRuleDto[]
}

/** Admin form list row (form discovery for the builder). */
export interface FormSummaryDto {
  readonly formId: FormId
  readonly eventId: EventId
  readonly slug: FormSlug
  readonly status: FormStatus
  readonly publishedVersionId: VersionId | null
  /** The submission window an organizer owns, so the settings card can show it. */
  readonly opensAt: UtcInstant | null
  readonly closesAt: UtcInstant | null
}

/** Full replace of the draft version content (PUT /draft body). */
export interface SaveFormDraftInput {
  readonly pages: readonly FormPage[]
  readonly elements: readonly FormElement[]
  readonly conditionRules: readonly ElementRule[]
  readonly routingRules: readonly RoutingRule[]
}

export function toFormDefinitionDto(
  form: CfpForm,
  eventSlug: EventSlug,
  version: FormVersion,
  content: FormVersionContent,
  now: UtcInstant,
): FormDefinitionDto {
  if (
    version.status !== 'published' ||
    version.contentHash === null ||
    version.publishedAt === null
  ) {
    throw new Error(`Cannot build a public definition from non-published version '${version.id}'`)
  }
  return {
    formId: form.id,
    formSlug: form.slug,
    eventSlug,
    versionId: version.id,
    version: version.version,
    status: 'published',
    contentHash: version.contentHash,
    publishedAt: version.publishedAt,
    opensAt: form.limits.opensAt,
    closesAt: form.limits.closesAt,
    submissionState: submissionStateOf(form.limits, now),
    pages: content.pages.map(toFormPageDto),
    elements: content.elements.map(toFormElementDto),
    conditionRules: content.conditionRules.map(toElementRuleDto),
  }
}

export function toFormVersionDetailDto(
  version: FormVersion,
  content: FormVersionContent,
): FormVersionDetailDto {
  return {
    formId: version.formId,
    eventId: version.eventId,
    versionId: version.id,
    version: version.version,
    status: version.status,
    contentHash: version.contentHash,
    publishedAt: version.publishedAt,
    updatedAt: version.updatedAt,
    pages: content.pages.map(toFormPageDto),
    elements: content.elements.map(toFormElementDto),
    conditionRules: content.conditionRules.map(toElementRuleDto),
    routingRules: content.routingRules.map(toRoutingRuleDto),
  }
}

export function toFormVersionSummaryDto(version: FormVersion): FormVersionSummaryDto {
  return {
    id: version.id,
    formId: version.formId,
    version: version.version,
    status: version.status,
    contentHash: version.contentHash,
    publishedAt: version.publishedAt,
    updatedAt: version.updatedAt,
  }
}

export function toFormSummaryDto(form: CfpForm): FormSummaryDto {
  return {
    formId: form.id,
    eventId: form.eventId,
    slug: form.slug,
    status: form.status,
    publishedVersionId: form.publishedVersionId,
    opensAt: form.limits.opensAt,
    closesAt: form.limits.closesAt,
  }
}

export function toFormPageDto(page: FormPage): FormPageDto {
  return {
    id: page.id,
    position: page.position,
    kind: page.kind,
    title: page.title,
    content: page.content,
  }
}

export function toFormElementDto(element: FormElement): FormElementDto {
  return {
    id: element.id,
    position: element.position,
    pageId: element.pageId,
    kind: element.kind,
    fieldKey: element.fieldKey,
    label: element.label,
    required: element.required,
    maxLength: element.maxLength,
    questionType: element.questionType,
    options: element.options,
  }
}

export function toElementRuleDto(rule: ElementRule): ElementRuleDto {
  return {
    id: rule.id,
    elementId: rule.elementId,
    effect: rule.effect,
    groups: rule.groups.map(toElementConditionGroupDto),
    position: rule.position,
  }
}

export function toElementConditionGroupDto(group: ElementConditionGroup): ElementConditionGroupDto {
  return {
    groupIndex: group.groupIndex,
    conditions: group.conditions.map(toElementConditionDto),
  }
}

export function toElementConditionDto(condition: ElementCondition): ElementConditionDto {
  return {
    operator: condition.operator,
    operandKey: condition.operandKey,
    value: condition.value,
  }
}

export function toRoutingRuleDto(rule: RoutingRule): RoutingRuleDto {
  return {
    id: rule.id,
    position: rule.position,
    condition: {
      groups: rule.condition.groups.map((group) => ({
        conditions: group.conditions.map(toElementConditionDto),
      })),
    },
    actionKind: rule.actionKind,
    actionTarget: rule.actionTarget,
  }
}
