import type { ElementConditionGroupDto, ElementRuleDto, FormElementDto } from '../../application'
import type { AnswerMap, ElementConditionGroup, ElementRule, FormElement } from '../../domain'
import { evaluateElementGroups, isElementRequired, isElementVisible } from '../../domain/rules'

/**
 * Adapter boundary: the public DTOs are structurally compatible with the
 * engine's domain inputs (the evaluators read only fields present on the
 * DTOs). Each wrapper performs one bounded cast at this boundary; no fake
 * runtime identifiers are fabricated.
 */
export function isElementVisibleDto(
  element: FormElementDto,
  rules: readonly ElementRuleDto[],
  answers: AnswerMap,
): boolean {
  return isElementVisible(
    element as unknown as FormElement,
    rules as unknown as readonly ElementRule[],
    answers,
  )
}

export function isElementRequiredDto(
  element: FormElementDto,
  rules: readonly ElementRuleDto[],
  answers: AnswerMap,
): boolean {
  return isElementRequired(
    element as unknown as FormElement,
    rules as unknown as readonly ElementRule[],
    answers,
  )
}

export function evaluateElementGroupsDto(
  groups: readonly ElementConditionGroupDto[],
  answers: AnswerMap,
): boolean {
  return evaluateElementGroups(groups as unknown as readonly ElementConditionGroup[], answers)
}
