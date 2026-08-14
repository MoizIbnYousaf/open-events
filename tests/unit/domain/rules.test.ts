import { describe, expect, it } from 'vitest'

import {
  CONDITION_EFFECTS,
  CONDITION_OPERATORS,
  ROUTING_ACTIONS,
  applyRoutingRules,
  evaluateConditionSet,
  evaluateElementCondition,
  evaluateElementGroups,
  isElementRequired,
  isElementVisible,
} from '../../../src/domain'
import {
  condition,
  createContent,
  createElement,
  emailElement,
  formatElement,
  routeWorkshopRule,
  showWorkshopRule,
  workshopElement,
} from '../helpers/fixtures'

describe('rule vocabulary', () => {
  it('defines the frozen operators, effects, and routing actions', () => {
    expect(CONDITION_OPERATORS).toEqual(['eq', 'ne', 'contains', 'gt', 'lt', 'empty', 'not-empty'])
    expect(CONDITION_EFFECTS).toEqual(['show', 'hide', 'require'])
    expect(ROUTING_ACTIONS).toEqual(['assign_track', 'assign_tag', 'manual_review'])
  })
})

describe('evaluateElementCondition', () => {
  it('evaluates eq/ne against string answers', () => {
    expect(evaluateElementCondition(condition({ value: 'workshop' }), { format: 'workshop' })).toBe(
      true,
    )
    expect(evaluateElementCondition(condition({ value: 'workshop' }), { format: 'talk' })).toBe(
      false,
    )
    expect(
      evaluateElementCondition(condition({ operator: 'ne', value: 'workshop' }), {
        format: 'talk',
      }),
    ).toBe(true)
  })

  it('evaluates gt/lt against numeric answers', () => {
    expect(
      evaluateElementCondition(condition({ operator: 'gt', operandKey: 'attendees', value: 50 }), {
        attendees: 100,
      }),
    ).toBe(true)
    expect(
      evaluateElementCondition(condition({ operator: 'lt', operandKey: 'attendees', value: 50 }), {
        attendees: 100,
      }),
    ).toBe(false)
  })

  it('returns false for gt/lt when the answer is not a number', () => {
    expect(
      evaluateElementCondition(condition({ operator: 'gt', operandKey: 'attendees', value: 1 }), {
        attendees: 'many',
      }),
    ).toBe(false)
    expect(
      evaluateElementCondition(
        condition({ operator: 'lt', operandKey: 'attendees', value: 1 }),
        {},
      ),
    ).toBe(false)
  })

  it('evaluates contains against text and multi-choice answers', () => {
    expect(
      evaluateElementCondition(
        condition({ operator: 'contains', operandKey: 'workshop', value: 'Hands' }),
        {
          workshop: 'Hands-on lab',
        },
      ),
    ).toBe(true)
    expect(
      evaluateElementCondition(
        condition({ operator: 'contains', operandKey: 'topics', value: 'ai' }),
        {
          topics: ['ai', 'web'],
        },
      ),
    ).toBe(true)
    expect(
      evaluateElementCondition(
        condition({ operator: 'contains', operandKey: 'topics', value: 'cloud' }),
        {
          topics: ['ai'],
        },
      ),
    ).toBe(false)
  })

  it('evaluates empty/not-empty across absent, blank, and empty-list answers', () => {
    expect(
      evaluateElementCondition(condition({ operator: 'empty', operandKey: 'workshop' }), {}),
    ).toBe(true)
    expect(
      evaluateElementCondition(condition({ operator: 'empty', operandKey: 'workshop' }), {
        workshop: '   ',
      }),
    ).toBe(true)
    expect(
      evaluateElementCondition(condition({ operator: 'empty', operandKey: 'topics' }), {
        topics: [],
      }),
    ).toBe(true)
    expect(
      evaluateElementCondition(condition({ operator: 'not-empty', operandKey: 'workshop' }), {
        workshop: 'Hands-on',
      }),
    ).toBe(true)
    expect(
      evaluateElementCondition(condition({ operator: 'not-empty', operandKey: 'workshop' }), {}),
    ).toBe(false)
  })
})

describe('condition groups', () => {
  it('ANDs conditions within a group and ORs groups', () => {
    const groups = [
      {
        groupIndex: 0,
        conditions: [
          condition({ value: 'workshop' }),
          condition({ operandKey: 'topics', operator: 'contains' as const, value: 'ai' }),
        ],
      },
      {
        groupIndex: 1,
        conditions: [condition({ operator: 'empty' as const, operandKey: 'attendees' })],
      },
    ]

    expect(evaluateElementGroups(groups, { format: 'workshop', topics: ['ai'] })).toBe(true)
    expect(evaluateElementGroups(groups, { format: 'workshop' })).toBe(true)
    expect(evaluateElementGroups(groups, { format: 'talk', attendees: 5 })).toBe(false)
  })

  it('always matches when there are no groups', () => {
    expect(evaluateElementGroups([], {})).toBe(true)
    expect(evaluateConditionSet({ groups: [] }, {})).toBe(true)
  })
})

describe('isElementVisible', () => {
  const content = createContent()

  it('shows an element by default when it has no rules', () => {
    expect(isElementVisible(emailElement, content.conditionRules, {})).toBe(true)
  })

  it('reveals an element only while a show rule matches', () => {
    expect(isElementVisible(workshopElement, content.conditionRules, { format: 'workshop' })).toBe(
      true,
    )
    expect(isElementVisible(workshopElement, content.conditionRules, { format: 'talk' })).toBe(
      false,
    )
  })

  it('lets any matching hide rule win', () => {
    const rules = [
      ...content.conditionRules,
      {
        ...showWorkshopRule,
        id: 'rule-hide-email',
        elementId: emailElement.id,
        effect: 'hide' as const,
        groups: [{ groupIndex: 0, conditions: [condition()] }],
      },
    ]

    expect(isElementVisible(emailElement, rules, { format: 'workshop' })).toBe(false)
    expect(isElementVisible(emailElement, rules, { format: 'talk' })).toBe(true)
  })
})

describe('isElementRequired', () => {
  const content = createContent()

  it('treats explicitly required elements as always required', () => {
    const element = createElement({ ...formatElement, required: true })
    expect(isElementRequired(element, [], {})).toBe(true)
  })

  it('applies a require rule only while its groups match', () => {
    const rule = {
      ...showWorkshopRule,
      id: 'rule-require-workshop',
      elementId: workshopElement.id,
      effect: 'require' as const,
    }
    expect(
      isElementRequired(workshopElement, [...content.conditionRules, rule], {
        format: 'workshop',
      }),
    ).toBe(true)
    expect(
      isElementRequired(workshopElement, [...content.conditionRules, rule], { format: 'talk' }),
    ).toBe(false)
  })
})

describe('applyRoutingRules', () => {
  it('evaluates rules in position order and returns the first match', () => {
    const first = routeWorkshopRule
    const second = {
      ...routeWorkshopRule,
      id: 'route-manual',
      position: 1,
      condition: { groups: [] },
      actionKind: 'manual_review' as const,
      actionTarget: null,
    }

    expect(applyRoutingRules([second, first], { format: 'workshop' })).toEqual({
      actionKind: 'assign_track',
      actionTarget: 'workshop',
    })
  })

  it('returns the first always-matching rule when no condition narrows it', () => {
    const always = {
      ...routeWorkshopRule,
      id: 'route-always',
      condition: { groups: [] },
      actionKind: 'manual_review' as const,
      actionTarget: null,
    }

    expect(applyRoutingRules([always], {})).toEqual({
      actionKind: 'manual_review',
      actionTarget: null,
    })
  })

  it('returns null when no routing rule matches', () => {
    expect(applyRoutingRules([routeWorkshopRule], { format: 'talk' })).toBeNull()
    expect(applyRoutingRules([], {})).toBeNull()
  })
})
