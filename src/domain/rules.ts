import { getAnswer, isValueEmpty, type AnswerMap } from './answers.ts'
import type { EventId } from './event.ts'
import type { ElementFieldKey, ElementId, FormElement, VersionId } from './form-version.ts'
import type { TaxonomyKey } from './taxonomy.ts'

export type RuleId = string

export const CONDITION_OPERATORS = [
  'eq',
  'ne',
  'contains',
  'gt',
  'lt',
  'empty',
  'not-empty',
] as const

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

export const CONDITION_EFFECTS = ['show', 'hide', 'require'] as const

export type ConditionEffect = (typeof CONDITION_EFFECTS)[number]

export const ROUTING_ACTIONS = ['assign_track', 'assign_tag', 'manual_review'] as const

export type RoutingActionKind = (typeof ROUTING_ACTIONS)[number]

export type ConditionValue = string | number | boolean

/** One predicate: source field `operandKey` compared via `operator` against `value`. */
export interface ElementCondition {
  readonly operator: ConditionOperator
  readonly operandKey: ElementFieldKey
  readonly value: ConditionValue | null
}

/** Conditions inside one group are ANDed together. */
export interface ElementConditionGroup {
  readonly groupIndex: number
  readonly conditions: readonly ElementCondition[]
}

/**
 * Element-level conditional rule: when its condition groups match, `effect`
 * applies to the target `elementId`. Groups are ORed; a rule with no groups
 * always matches.
 */
export interface ElementRule {
  readonly id: RuleId
  readonly eventId: EventId
  readonly versionId: VersionId
  readonly elementId: ElementId
  readonly effect: ConditionEffect
  readonly groups: readonly ElementConditionGroup[]
  readonly position: number
}

export interface ConditionGroup {
  readonly conditions: readonly ElementCondition[]
}

/** Routing conditions: groups ORed, conditions within a group ANDed. */
export interface ConditionSet {
  readonly groups: readonly ConditionGroup[]
}

/**
 * Routing rule evaluated in `position` order over the submitted answers. The
 * first matching rule determines the routing outcome.
 */
export interface RoutingRule {
  readonly id: RuleId
  readonly eventId: EventId
  readonly versionId: VersionId
  readonly position: number
  readonly condition: ConditionSet
  readonly actionKind: RoutingActionKind
  /** Required for assign_track/assign_tag; must be null for manual_review. */
  readonly actionTarget: TaxonomyKey | null
}

/** Snapshot of the routing action applied at submit time. */
export interface RoutingOutcome {
  readonly actionKind: RoutingActionKind
  readonly actionTarget: TaxonomyKey | null
}

export function evaluateElementCondition(condition: ElementCondition, answers: AnswerMap): boolean {
  const actual = getAnswer(answers, condition.operandKey)
  switch (condition.operator) {
    case 'empty':
      return isValueEmpty(actual)
    case 'not-empty':
      return !isValueEmpty(actual)
    case 'eq':
      return condition.value !== null && actual === condition.value
    case 'ne':
      return condition.value !== null && actual !== condition.value
    case 'contains': {
      if (typeof condition.value !== 'string') return false
      if (typeof actual === 'string') return actual.includes(condition.value)
      if (Array.isArray(actual)) return actual.includes(condition.value)
      return false
    }
    case 'gt':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual > condition.value
      )
    case 'lt':
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual < condition.value
      )
  }
}

export function evaluateElementGroups(
  groups: readonly ElementConditionGroup[],
  answers: AnswerMap,
): boolean {
  if (groups.length === 0) return true
  return groups.some((group) =>
    group.conditions.every((item) => evaluateElementCondition(item, answers)),
  )
}

export function evaluateConditionSet(conditionSet: ConditionSet, answers: AnswerMap): boolean {
  if (conditionSet.groups.length === 0) return true
  return conditionSet.groups.some((group) =>
    group.conditions.every((item) => evaluateElementCondition(item, answers)),
  )
}

/**
 * Visibility semantics: an element is visible by default; when it has `show`
 * rules it is only visible while one matches; any matching `hide` rule wins.
 */
export function isElementVisible(
  element: FormElement,
  rules: readonly ElementRule[],
  answers: AnswerMap,
): boolean {
  const hasShowRules = rules.some((rule) => rule.elementId === element.id && rule.effect === 'show')
  const shown =
    !hasShowRules ||
    rules.some(
      (rule) =>
        rule.elementId === element.id &&
        rule.effect === 'show' &&
        evaluateElementGroups(rule.groups, answers),
    )
  const hidden = rules.some(
    (rule) =>
      rule.elementId === element.id &&
      rule.effect === 'hide' &&
      evaluateElementGroups(rule.groups, answers),
  )
  return shown && !hidden
}

export function isElementRequired(
  element: FormElement,
  rules: readonly ElementRule[],
  answers: AnswerMap,
): boolean {
  if (element.required) return true
  return rules.some(
    (rule) =>
      rule.elementId === element.id &&
      rule.effect === 'require' &&
      evaluateElementGroups(rule.groups, answers),
  )
}

export function applyRoutingRules(
  rules: readonly RoutingRule[],
  answers: AnswerMap,
): RoutingOutcome | null {
  const ordered = rules.toSorted((a, b) => a.position - b.position)
  for (const rule of ordered) {
    if (evaluateConditionSet(rule.condition, answers)) {
      return { actionKind: rule.actionKind, actionTarget: rule.actionTarget }
    }
  }
  return null
}
