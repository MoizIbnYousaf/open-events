import type { EventId, UtcInstant } from './event.ts'
import type { FormId } from './form.ts'
import type { ElementRule, RoutingRule } from './rules.ts'

export type VersionId = string
export type PageId = string
export type ElementId = string

/** Stable key of a bound field/question within a form version, e.g. 'format'. */
export type ElementFieldKey = string

/** Form version numbers are positive integers (>= 1). */
export type VersionNumber = number

export const VERSION_STATUSES = ['draft', 'published'] as const

export type VersionStatus = (typeof VERSION_STATUSES)[number]

/**
 * One numbered version of a CFP form. Published versions are frozen: rows under
 * a published version must not be mutated (see `validateVersionFreeze`).
 */
export interface FormVersion {
  readonly id: VersionId
  readonly eventId: EventId
  readonly formId: FormId
  readonly version: VersionNumber
  readonly status: VersionStatus
  readonly contentHash: string | null
  readonly publishedAt: UtcInstant | null
  /** Last write instant; the optimistic-concurrency precondition for draft edits. */
  readonly updatedAt: UtcInstant
}

export const PAGE_KINDS = ['welcome', 'info', 'review', 'submit'] as const

export type PageKind = (typeof PAGE_KINDS)[number]

export interface FormPage {
  readonly id: PageId
  readonly eventId: EventId
  readonly versionId: VersionId
  readonly position: number
  readonly kind: PageKind
  readonly title: string
  readonly content: string
}

export const ELEMENT_KINDS = ['field', 'question', 'richtext', 'heading', 'divider'] as const

export type ElementKind = (typeof ELEMENT_KINDS)[number]

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'email',
  'number',
  'single_choice',
  'multi_choice',
] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

export interface FormElement {
  readonly id: ElementId
  readonly eventId: EventId
  readonly versionId: VersionId
  readonly pageId: PageId
  readonly position: number
  readonly kind: ElementKind
  /** Present only for `field`/`question` kinds; unique within a version. */
  readonly fieldKey: ElementFieldKey | null
  readonly label: string | null
  readonly required: boolean
  readonly maxLength: number | null
  readonly questionType: QuestionType | null
  readonly options: readonly string[]
}

/** Full immutable snapshot of one form version: pages, elements, and rules. */
export interface FormVersionContent {
  readonly pages: readonly FormPage[]
  readonly elements: readonly FormElement[]
  readonly conditionRules: readonly ElementRule[]
  readonly routingRules: readonly RoutingRule[]
}

/** Next draft version number for a form: max(existing) + 1 (>= 1). */
export function nextVersionNumber(versions: readonly FormVersion[]): VersionNumber {
  const highest = versions.reduce((max, version) => Math.max(max, version.version), 0)
  return highest + 1
}
