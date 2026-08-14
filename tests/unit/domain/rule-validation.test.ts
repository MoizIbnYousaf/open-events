import { describe, expect, it } from 'vitest'

import type { ElementRule, FormVersionContent, TaxonomyKind } from '../../../src/domain'
import { detectRuleCycles, validateVersionRules } from '../../../src/domain'
import {
  condition,
  createContent,
  createElement,
  createPage,
  formatElement,
  routeWorkshopRule,
  showWorkshopRule,
  workshopElement,
} from '../helpers/fixtures'

const TAXONOMY_REFERENCE: ReadonlyMap<string, TaxonomyKind> = new Map([
  ['workshop', 'track'],
  ['ai-track', 'track'],
  ['ai-tag', 'tag'],
  ['format-talk', 'format'],
])

function issueCodes(content: FormVersionContent): readonly string[] {
  return validateVersionRules(content, TAXONOMY_REFERENCE).map((issue) => issue.code)
}

describe('validateVersionRules', () => {
  it('accepts a well-formed version with valid rules and routing', () => {
    expect(validateVersionRules(createContent(), TAXONOMY_REFERENCE)).toEqual([])
  })

  it('rejects rules targeting an unknown element', () => {
    const content = createContent({
      conditionRules: [{ ...showWorkshopRule, elementId: 'element-ghost' }],
    })

    expect(issueCodes(content)).toContain('missing_target_element')
  })

  it('rejects conditions reading an unknown field', () => {
    const content = createContent({
      conditionRules: [
        {
          ...showWorkshopRule,
          groups: [{ groupIndex: 0, conditions: [condition({ operandKey: 'missing-field' })] }],
        },
      ],
    })

    expect(issueCodes(content)).toContain('missing_operand_field')
  })

  it('rejects operands that are not bound questions or fields', () => {
    const heading = createElement({
      id: 'element-heading',
      position: 6,
      kind: 'heading',
      fieldKey: 'heading-key',
      label: 'Heading',
      questionType: null,
    })
    const content = createContent({
      elements: [...createContent().elements, heading],
      conditionRules: [
        {
          ...showWorkshopRule,
          groups: [{ groupIndex: 0, conditions: [condition({ operandKey: 'heading-key' })] }],
        },
      ],
    })

    expect(issueCodes(content)).toContain('invalid_operand_kind')
  })

  it('rejects type-incompatible operand values per operator', () => {
    const cases = [
      condition({ operator: 'gt', operandKey: 'format', value: 3 }),
      condition({ operator: 'contains', operandKey: 'attendees', value: 'x' }),
      condition({ operator: 'lt', operandKey: 'contact-email', value: 5 }),
      condition({ operator: 'eq', operandKey: 'attendees', value: 'many' }),
      condition({ operator: 'eq', operandKey: 'format', value: true }),
    ]
    for (const bad of cases) {
      const content = createContent({
        conditionRules: [
          {
            ...showWorkshopRule,
            groups: [{ groupIndex: 0, conditions: [bad] }],
          },
        ],
      })
      expect(issueCodes(content)).toContain('invalid_operand_value')
    }
  })

  it('rejects binary operators without a value and empty operators with one', () => {
    const missingValue = createContent({
      conditionRules: [
        {
          ...showWorkshopRule,
          groups: [{ groupIndex: 0, conditions: [condition({ value: null })] }],
        },
      ],
    })
    const unexpectedValue = createContent({
      conditionRules: [
        {
          ...showWorkshopRule,
          groups: [
            {
              groupIndex: 0,
              conditions: [condition({ operator: 'empty', operandKey: 'workshop', value: 'x' })],
            },
          ],
        },
      ],
    })

    expect(issueCodes(missingValue)).toContain('missing_operand_value')
    expect(issueCodes(unexpectedValue)).toContain('unexpected_operand_value')
  })

  it('rejects negative and duplicate positions for pages, elements, and rules', () => {
    const negativePage = createContent({ pages: [createPage({ position: -1 })] })
    const duplicateElements = createContent({
      elements: [
        formatElement,
        createElement({ ...workshopElement, position: formatElement.position }),
      ],
    })
    const duplicateRules = createContent({
      conditionRules: [showWorkshopRule, { ...showWorkshopRule, id: 'rule-b' }],
    })
    const duplicateRouting = createContent({
      routingRules: [routeWorkshopRule, { ...routeWorkshopRule, id: 'route-b' }],
    })

    expect(issueCodes(negativePage)).toContain('negative_position')
    expect(issueCodes(duplicateElements)).toContain('duplicate_position')
    expect(issueCodes(duplicateRules)).toContain('duplicate_position')
    expect(issueCodes(duplicateRouting)).toContain('duplicate_position')
  })

  it('rejects elements referencing an unknown page', () => {
    const content = createContent({
      elements: [createElement({ ...formatElement, pageId: 'page-ghost' })],
    })

    expect(issueCodes(content)).toContain('missing_page_reference')
  })

  it('rejects duplicate field keys within a version', () => {
    const content = createContent({
      elements: [
        formatElement,
        createElement({ ...workshopElement, fieldKey: formatElement.fieldKey }),
      ],
    })

    expect(issueCodes(content)).toContain('duplicate_field_key')
  })

  it('validates routing action targets against the event taxonomy', () => {
    const missingTarget = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          actionKind: 'assign_track',
          actionTarget: null,
        },
      ],
    })
    const unknownTarget = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          actionKind: 'assign_tag',
          actionTarget: 'not-a-key',
        },
      ],
    })
    const unexpectedTarget = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          actionKind: 'manual_review',
          actionTarget: 'workshop',
        },
      ],
    })

    expect(issueCodes(missingTarget)).toContain('missing_routing_target')
    expect(issueCodes(unknownTarget)).toContain('unknown_routing_target')
    expect(issueCodes(unexpectedTarget)).toContain('unexpected_routing_target')
  })
})

describe('detectRuleCycles', () => {
  function cycleContent(a: ElementRule, b: ElementRule | null): FormVersionContent {
    return createContent({
      conditionRules: b === null ? [a] : [a, b],
    })
  }

  const aRule: ElementRule = {
    ...showWorkshopRule,
    id: 'rule-a',
    elementId: workshopElement.id,
    groups: [
      { groupIndex: 0, conditions: [condition({ operandKey: formatElement.fieldKey ?? '' })] },
    ],
  }
  const bRule: ElementRule = {
    ...showWorkshopRule,
    id: 'rule-b',
    elementId: formatElement.id,
    groups: [
      { groupIndex: 0, conditions: [condition({ operandKey: workshopElement.fieldKey ?? '' })] },
    ],
  }

  it('rejects a direct two-element cycle', () => {
    const cycles = detectRuleCycles(cycleContent(aRule, bRule))
    const issues = validateVersionRules(cycleContent(aRule, bRule), TAXONOMY_REFERENCE)

    expect(cycles.length).toBeGreaterThan(0)
    expect(issueCodes(cycleContent(aRule, bRule))).toContain('dependency_cycle')
    expect(issues.some((issue) => issue.elementId !== undefined)).toBe(true)
  })

  it('rejects a self-dependency', () => {
    const selfRule: ElementRule = {
      ...aRule,
      elementId: formatElement.id,
      groups: [
        { groupIndex: 0, conditions: [condition({ operandKey: formatElement.fieldKey ?? '' })] },
      ],
    }

    expect(issueCodes(cycleContent(selfRule, null))).toContain('dependency_cycle')
  })

  it('rejects an indirect multi-element cycle', () => {
    const third = createElement({
      id: 'element-third',
      position: 6,
      fieldKey: 'third',
      label: 'Third',
      required: false,
      questionType: 'short_text',
    })
    const ruleA: ElementRule = {
      ...aRule,
      elementId: third.id,
      groups: [{ groupIndex: 0, conditions: [condition({ operandKey: 'format' })] }],
    }
    const ruleB: ElementRule = {
      ...bRule,
      elementId: formatElement.id,
      groups: [{ groupIndex: 0, conditions: [condition({ operandKey: 'third' })] }],
    }
    const content = createContent({
      elements: [...createContent().elements, third],
      conditionRules: [ruleA, ruleB],
    })

    expect(issueCodes(content)).toContain('dependency_cycle')
  })

  it('accepts an acyclic dependency chain', () => {
    const content = createContent({
      conditionRules: [
        {
          ...aRule,
          groups: [{ groupIndex: 0, conditions: [condition({ operandKey: 'format' })] }],
        },
      ],
    })

    expect(detectRuleCycles(content)).toEqual([])
    expect(validateVersionRules(content, TAXONOMY_REFERENCE)).toEqual([])
  })
})

describe('corrected contract: routing conditions and kind-aware targets', () => {
  it('validates routing-condition field references and operator/value types', () => {
    const missingField = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          condition: {
            groups: [
              {
                conditions: [{ operator: 'eq', operandKey: 'ghost-field', value: 'x' }],
              },
            ],
          },
        },
      ],
    })
    const badType = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          condition: {
            groups: [
              {
                conditions: [{ operator: 'gt', operandKey: 'format', value: 3 }],
              },
            ],
          },
        },
      ],
    })

    expect(issueCodes(missingField)).toContain('missing_operand_field')
    expect(issueCodes(badType)).toContain('invalid_operand_value')
  })

  it('rejects empty or malformed condition groups on element and routing rules', () => {
    const noGroups = createContent({
      conditionRules: [{ ...showWorkshopRule, groups: [] }],
    })
    const emptyGroup = createContent({
      conditionRules: [{ ...showWorkshopRule, groups: [{ groupIndex: 0, conditions: [] }] }],
    })
    const routingNoGroups = createContent({
      routingRules: [{ ...routeWorkshopRule, condition: { groups: [] } }],
    })
    const routingEmptyGroup = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          condition: { groups: [{ conditions: [] }] },
        },
      ],
    })

    expect(issueCodes(noGroups)).toContain('empty_condition_groups')
    expect(issueCodes(emptyGroup)).toContain('empty_condition_group')
    expect(issueCodes(routingNoGroups)).toContain('empty_condition_groups')
    expect(issueCodes(routingEmptyGroup)).toContain('empty_condition_group')
  })

  it('rejects invalid, duplicate, and unordered group indexes', () => {
    const invalid = createContent({
      conditionRules: [
        {
          ...showWorkshopRule,
          groups: [{ groupIndex: -1, conditions: [condition()] }],
        },
      ],
    })
    const fractional = createContent({
      conditionRules: [
        {
          ...showWorkshopRule,
          groups: [{ groupIndex: 1.5, conditions: [condition()] }],
        },
      ],
    })
    const duplicate = createContent({
      conditionRules: [
        {
          ...showWorkshopRule,
          groups: [
            { groupIndex: 0, conditions: [condition()] },
            { groupIndex: 0, conditions: [condition({ value: 'talk' })] },
          ],
        },
      ],
    })
    const unordered = createContent({
      conditionRules: [
        {
          ...showWorkshopRule,
          groups: [
            { groupIndex: 1, conditions: [condition()] },
            { groupIndex: 0, conditions: [condition({ value: 'talk' })] },
          ],
        },
      ],
    })

    expect(issueCodes(invalid)).toContain('invalid_group_index')
    expect(issueCodes(fractional)).toContain('invalid_group_index')
    expect(issueCodes(duplicate)).toContain('duplicate_group_index')
    expect(issueCodes(unordered)).toContain('unordered_groups')
  })

  it('enforces action-kind compatibility against the event taxonomy kinds', () => {
    const trackToTag = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          actionKind: 'assign_track',
          actionTarget: 'ai-tag',
        },
      ],
    })
    const tagToTrack = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          actionKind: 'assign_tag',
          actionTarget: 'workshop',
        },
      ],
    })
    const trackToFormat = createContent({
      routingRules: [
        {
          ...routeWorkshopRule,
          actionKind: 'assign_track',
          actionTarget: 'format-talk',
        },
      ],
    })
    const valid = createContent({
      routingRules: [
        routeWorkshopRule,
        {
          ...routeWorkshopRule,
          id: 'route-tag',
          position: 1,
          actionKind: 'assign_tag',
          actionTarget: 'ai-tag',
        },
      ],
    })

    expect(
      validateVersionRules(trackToTag, TAXONOMY_REFERENCE).map((issue) => issue.code),
    ).toContain('incompatible_routing_target')
    expect(
      validateVersionRules(tagToTrack, TAXONOMY_REFERENCE).map((issue) => issue.code),
    ).toContain('incompatible_routing_target')
    expect(
      validateVersionRules(trackToFormat, TAXONOMY_REFERENCE).map((issue) => issue.code),
    ).toContain('incompatible_routing_target')
    expect(validateVersionRules(valid, TAXONOMY_REFERENCE)).toEqual([])
  })

  it('reports unknown routing targets when the kind-aware taxonomy lacks the key', () => {
    const unknown = createContent({
      routingRules: [{ ...routeWorkshopRule, actionTarget: 'not-a-key' }],
    })

    expect(validateVersionRules(unknown, TAXONOMY_REFERENCE).map((issue) => issue.code)).toContain(
      'unknown_routing_target',
    )
  })
})

describe('corrected contract: per-page element ordering', () => {
  it('allows position 0 on two different pages', () => {
    const secondPage = createPage({ id: 'page-two', position: 1, kind: 'submit', title: 'Review' })
    const secondElement = createElement({
      id: 'element-review',
      pageId: secondPage.id,
      position: 0,
      fieldKey: 'review-note',
    })
    const content = createContent({
      pages: [createPage(), secondPage],
      elements: [formatElement, secondElement],
      conditionRules: [],
    })

    expect(validateVersionRules(content, TAXONOMY_REFERENCE)).toEqual([])
  })

  it('rejects duplicate positions within one page', () => {
    const content = createContent({
      elements: [
        formatElement,
        createElement({ ...workshopElement, position: formatElement.position }),
      ],
    })

    expect(issueCodes(content)).toContain('duplicate_position')
  })
})
