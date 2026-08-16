import type {
  ElementFieldKey,
  ElementId,
  FormElement,
  FormVersionContent,
  PageId,
} from '../form-version.ts'
import type { ConditionOperator, ConditionValue, ElementCondition, RuleId } from '../rules.ts'
import type { QuestionType } from '../form-version.ts'
import type { TaxonomyKey, TaxonomyKind } from '../taxonomy.ts'

export type RuleIssueCode =
  | 'missing_target_element'
  | 'missing_operand_field'
  | 'invalid_operand_kind'
  | 'invalid_operand_value'
  | 'missing_operand_value'
  | 'unexpected_operand_value'
  | 'negative_position'
  | 'duplicate_position'
  | 'missing_page_reference'
  | 'duplicate_field_key'
  | 'missing_routing_target'
  | 'unknown_routing_target'
  | 'incompatible_routing_target'
  | 'unexpected_routing_target'
  | 'dependency_cycle'
  | 'invalid_group_index'
  | 'duplicate_group_index'
  | 'unordered_groups'
  | 'empty_condition_group'
  | 'empty_condition_groups'

export interface RuleValidationIssue {
  readonly code: RuleIssueCode
  readonly message: string
  readonly ruleId?: RuleId
  readonly elementId?: ElementId
  readonly fieldKey?: ElementFieldKey
}

/**
 * Event taxonomy for routing-target validation: `assign_track` must target a
 * track key and `assign_tag` a tag key. Membership-only validation is never
 * accepted.
 */
export type TaxonomyReference = ReadonlyMap<TaxonomyKey, TaxonomyKind>

function isConditionValueCompatible(
  questionType: QuestionType,
  operator: ConditionOperator,
  value: ConditionValue | null,
): boolean {
  if (operator === 'empty' || operator === 'not-empty') return value === null
  if (value === null) return false
  switch (operator) {
    case 'gt':
    case 'lt':
      return questionType === 'number' && typeof value === 'number'
    case 'contains': {
      const textLike =
        questionType === 'short_text' || questionType === 'long_text' || questionType === 'email'
      return (textLike || questionType === 'multi_choice') && typeof value === 'string'
    }
    case 'eq':
    case 'ne': {
      if (questionType === 'number') return typeof value === 'number'
      return typeof value === 'string'
    }
  }
}

/**
 * Shared condition validator used for both element rules and routing rules:
 * missing field references, operand kind, and operator/value typing.
 */
function validateCondition(
  condition: ElementCondition,
  fieldsByKey: ReadonlyMap<ElementFieldKey, FormElement>,
  ruleId: RuleId,
  issues: RuleValidationIssue[],
): void {
  const source = fieldsByKey.get(condition.operandKey)
  if (source === undefined) {
    issues.push({
      code: 'missing_operand_field',
      message: `Rule '${ruleId}' references unknown field '${condition.operandKey}'`,
      ruleId,
      fieldKey: condition.operandKey,
    })
    return
  }
  const isFieldLike = source.kind === 'field' || source.kind === 'question'
  if (!isFieldLike || source.fieldKey === null || source.questionType === null) {
    issues.push({
      code: 'invalid_operand_kind',
      message: `Operand '${condition.operandKey}' is not a bound field or question`,
      ruleId,
      fieldKey: condition.operandKey,
    })
    return
  }
  const questionType = source.questionType
  if (condition.operator === 'empty' || condition.operator === 'not-empty') {
    if (condition.value !== null) {
      issues.push({
        code: 'unexpected_operand_value',
        message: `Operator '${condition.operator}' must not carry a value`,
        ruleId,
        fieldKey: condition.operandKey,
      })
    }
  } else if (condition.value === null) {
    issues.push({
      code: 'missing_operand_value',
      message: `Operator '${condition.operator}' requires a value`,
      ruleId,
      fieldKey: condition.operandKey,
    })
  } else if (!isConditionValueCompatible(questionType, condition.operator, condition.value)) {
    issues.push({
      code: 'invalid_operand_value',
      message: `Operator '${condition.operator}' is incompatible with field '${condition.operandKey}'`,
      ruleId,
      fieldKey: condition.operandKey,
    })
  }
}

function validateGroupIndexes(
  groups: readonly { readonly groupIndex: number }[],
  ruleId: RuleId,
  issues: RuleValidationIssue[],
): void {
  const seenIndexes = new Set<number>()
  let previousIndex = -1
  for (const group of groups) {
    if (!Number.isInteger(group.groupIndex) || group.groupIndex < 0) {
      issues.push({
        code: 'invalid_group_index',
        message: `Rule '${ruleId}' has an invalid group index ${group.groupIndex}`,
        ruleId,
      })
      continue
    }
    if (seenIndexes.has(group.groupIndex)) {
      issues.push({
        code: 'duplicate_group_index',
        message: `Rule '${ruleId}' repeats group index ${group.groupIndex}`,
        ruleId,
      })
    }
    if (group.groupIndex < previousIndex) {
      issues.push({
        code: 'unordered_groups',
        message: `Rule '${ruleId}' groups must be ordered by ascending group index`,
        ruleId,
      })
    }
    seenIndexes.add(group.groupIndex)
    previousIndex = group.groupIndex
  }
}

/**
 * Validates a form version's full content: element/page references, rule
 * operand/operator typing, per-page element ordering, group indexes/order,
 * routing targets (against the event's kind-aware taxonomy), empty condition
 * groups, and conditional dependency cycles.
 */
export function validateVersionRules(
  content: FormVersionContent,
  taxonomy: TaxonomyReference,
): readonly RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = []
  const elementsById = new Map(content.elements.map((element) => [element.id, element]))
  const pagesById = new Map(content.pages.map((page) => [page.id, page]))
  const fieldsByKey = new Map<ElementFieldKey, FormElement>()
  for (const element of content.elements) {
    if (element.fieldKey !== null) fieldsByKey.set(element.fieldKey, element)
  }

  const pagePositions = new Set<number>()
  for (const page of content.pages) {
    if (!Number.isInteger(page.position) || page.position < 0) {
      issues.push({
        code: 'negative_position',
        message: `Page '${page.id}' must have a non-negative integer position`,
      })
    } else if (pagePositions.has(page.position)) {
      issues.push({
        code: 'duplicate_position',
        message: `Duplicate page position ${page.position}`,
      })
    }
    pagePositions.add(page.position)
  }

  const elementPositionsByPage = new Map<PageId, Set<number>>()
  const seenFieldKeys = new Set<string>()
  for (const element of content.elements) {
    if (!Number.isInteger(element.position) || element.position < 0) {
      issues.push({
        code: 'negative_position',
        message: `Element '${element.id}' must have a non-negative integer position`,
        elementId: element.id,
      })
    } else {
      const positions = elementPositionsByPage.get(element.pageId) ?? new Set<number>()
      if (positions.has(element.position)) {
        issues.push({
          code: 'duplicate_position',
          message: `Duplicate element position ${element.position} on page '${element.pageId}'`,
          elementId: element.id,
        })
      }
      positions.add(element.position)
      elementPositionsByPage.set(element.pageId, positions)
    }
    if (!pagesById.has(element.pageId)) {
      issues.push({
        code: 'missing_page_reference',
        message: `Element '${element.id}' references unknown page '${element.pageId}'`,
        elementId: element.id,
      })
    }
    if (element.fieldKey !== null) {
      if (seenFieldKeys.has(element.fieldKey)) {
        issues.push({
          code: 'duplicate_field_key',
          message: `Field key '${element.fieldKey}' is used more than once`,
          fieldKey: element.fieldKey,
        })
      }
      seenFieldKeys.add(element.fieldKey)
    }
  }

  const conditionPositions = new Set<number>()
  for (const rule of content.conditionRules) {
    if (!Number.isInteger(rule.position) || rule.position < 0) {
      issues.push({
        code: 'negative_position',
        message: `Rule '${rule.id}' must have a non-negative position`,
        ruleId: rule.id,
      })
    } else if (conditionPositions.has(rule.position)) {
      issues.push({
        code: 'duplicate_position',
        message: `Duplicate condition rule position ${rule.position}`,
        ruleId: rule.id,
      })
    }
    conditionPositions.add(rule.position)

    if (rule.groups.length === 0) {
      issues.push({
        code: 'empty_condition_groups',
        message: `Rule '${rule.id}' must define at least one condition group`,
        ruleId: rule.id,
      })
    }
    validateGroupIndexes(rule.groups, rule.id, issues)
    for (const group of rule.groups) {
      if (group.conditions.length === 0) {
        issues.push({
          code: 'empty_condition_group',
          message: `Rule '${rule.id}' has an empty condition group`,
          ruleId: rule.id,
        })
      }
      for (const condition of group.conditions) {
        validateCondition(condition, fieldsByKey, rule.id, issues)
      }
    }

    const target = elementsById.get(rule.elementId)
    if (target === undefined) {
      issues.push({
        code: 'missing_target_element',
        message: `Rule '${rule.id}' targets unknown element '${rule.elementId}'`,
        ruleId: rule.id,
        elementId: rule.elementId,
      })
    }
  }

  const routingPositions = new Set<number>()
  for (const rule of content.routingRules) {
    if (!Number.isInteger(rule.position) || rule.position < 0) {
      issues.push({
        code: 'negative_position',
        message: `Routing rule '${rule.id}' must have a non-negative position`,
        ruleId: rule.id,
      })
    } else if (routingPositions.has(rule.position)) {
      issues.push({
        code: 'duplicate_position',
        message: `Duplicate routing rule position ${rule.position}`,
        ruleId: rule.id,
      })
    }
    routingPositions.add(rule.position)

    if (rule.condition.groups.length === 0) {
      issues.push({
        code: 'empty_condition_groups',
        message: `Routing rule '${rule.id}' must define at least one condition group`,
        ruleId: rule.id,
      })
    }
    for (const group of rule.condition.groups) {
      if (group.conditions.length === 0) {
        issues.push({
          code: 'empty_condition_group',
          message: `Routing rule '${rule.id}' has an empty condition group`,
          ruleId: rule.id,
        })
      }
      for (const condition of group.conditions) {
        validateCondition(condition, fieldsByKey, rule.id, issues)
      }
    }

    if (rule.actionKind === 'manual_review') {
      if (rule.actionTarget !== null) {
        issues.push({
          code: 'unexpected_routing_target',
          message: `manual_review routing rule '${rule.id}' must not carry an action target`,
          ruleId: rule.id,
        })
      }
    } else if (rule.actionTarget === null) {
      issues.push({
        code: 'missing_routing_target',
        message: `Routing rule '${rule.id}' requires a taxonomy target`,
        ruleId: rule.id,
      })
    } else {
      const targetKind = taxonomy.get(rule.actionTarget)
      if (targetKind === undefined) {
        issues.push({
          code: 'unknown_routing_target',
          message: `Routing rule '${rule.id}' targets unknown taxonomy key '${rule.actionTarget}'`,
          ruleId: rule.id,
        })
      } else if (rule.actionKind === 'assign_track' && targetKind !== 'track') {
        issues.push({
          code: 'incompatible_routing_target',
          message: `assign_track routing rule '${rule.id}' must target a track key, not '${rule.actionTarget}' (${targetKind})`,
          ruleId: rule.id,
        })
      } else if (rule.actionKind === 'assign_tag' && targetKind !== 'tag') {
        issues.push({
          code: 'incompatible_routing_target',
          message: `assign_tag routing rule '${rule.id}' must target a tag key, not '${rule.actionTarget}' (${targetKind})`,
          ruleId: rule.id,
        })
      }
    }
  }

  const cycles = detectRuleCycles(content)
  if (cycles.length > 0 && cycles[0] !== undefined) {
    issues.push({
      code: 'dependency_cycle',
      message: `Cyclic element dependency: ${cycles[0].join(' -> ')}`,
      elementId: cycles[0][0],
    })
  }
  return issues
}

/**
 * Detects conditional dependency cycles over a version's element rules. A rule
 * on element A whose condition reads field of element B makes A depend on B;
 * a cycle means visibility/requiredness cannot be resolved deterministically.
 */
export function detectRuleCycles(content: FormVersionContent): readonly (readonly ElementId[])[] {
  const elementsById = new Map(content.elements.map((element) => [element.id, element]))
  const fieldsByKey = new Map<ElementFieldKey, ElementId>()
  for (const element of content.elements) {
    if (element.fieldKey !== null) fieldsByKey.set(element.fieldKey, element.id)
  }
  const adjacency = new Map<ElementId, ElementId[]>()
  for (const rule of content.conditionRules) {
    if (!elementsById.has(rule.elementId)) continue
    for (const group of rule.groups) {
      for (const condition of group.conditions) {
        const sourceId = fieldsByKey.get(condition.operandKey)
        if (sourceId === undefined) continue
        const targets = adjacency.get(rule.elementId) ?? []
        if (!targets.includes(sourceId)) targets.push(sourceId)
        adjacency.set(rule.elementId, targets)
      }
    }
  }

  const color = new Map<ElementId, 0 | 1 | 2>()
  const stack: ElementId[] = []
  const found: ElementId[][] = []

  const visit = (node: ElementId): void => {
    color.set(node, 1)
    stack.push(node)
    for (const next of adjacency.get(node) ?? []) {
      const nextColor = color.get(next)
      if (nextColor === 1) {
        const start = stack.indexOf(next)
        if (start !== -1) found.push(stack.slice(start))
      } else if (nextColor === undefined) {
        visit(next)
      }
    }
    stack.pop()
    color.set(node, 2)
  }

  for (const node of elementsById.keys()) {
    if (color.get(node) === undefined) visit(node)
  }

  const seen = new Set<string>()
  const unique: ElementId[][] = []
  for (const cycle of found) {
    const key = cycle.join('>')
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(cycle)
    }
  }
  return unique
}
