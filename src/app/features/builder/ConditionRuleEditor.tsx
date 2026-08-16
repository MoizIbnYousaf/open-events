import type {
  ConditionEffect,
  ConditionOperator,
  ElementCondition,
  ElementRule,
} from '../../../domain/rules'
import { CONDITION_EFFECTS } from '../../../domain/rules'
import type { ElementFieldKey, FormElement, QuestionType } from '../../../domain/form-version'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldError, FieldLabel, FieldTriggerLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { SectionHeading } from '../../../components/ui/section-heading'
import { CheckIcon } from '../../../components/ui/icons'

import { conditionValueKey, operatorOptionsFor } from './builder-model'

interface ConditionRuleEditorProps {
  readonly rules: readonly ElementRule[]
  readonly elements: readonly FormElement[]
  /**
   * conditionValueKey() of the condition the last save attempt rejected, so the
   * precise row — not just a form-level sentence — carries the message.
   */
  readonly invalidConditionKey: string | null
  readonly registerValueRef: (key: string) => (node: HTMLInputElement | null) => void
  readonly onUpdateRule: (ruleId: string, patch: Partial<ElementRule>) => void
}

export default function ConditionRuleEditor({
  rules,
  elements,
  invalidConditionKey,
  registerValueRef,
  onUpdateRule,
}: ConditionRuleEditorProps) {
  if (rules.length === 0) {
    return (
      <section>
        <Card>
          <CardHeader>
            <SectionHeading level={3}>Conditional visibility</SectionHeading>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={<CheckIcon size={20} />}
              title="Show a question only when it applies"
              description="A conditional rule reveals or hides a question based on an earlier answer, so nobody is asked something irrelevant."
            />
          </CardContent>
        </Card>
      </section>
    )
  }

  const operandOptions = elements.filter(
    (element) =>
      element.fieldKey !== null && (element.kind === 'field' || element.kind === 'question'),
  )
  const firstOperandKey = operandOptions[0]?.fieldKey ?? null

  const questionTypeFor = (operandKey: ElementFieldKey): QuestionType | null => {
    const element = elements.find((candidate) => candidate.fieldKey === operandKey)
    return element?.questionType ?? null
  }

  const updateCondition = (
    ruleId: string,
    groupIndex: number,
    conditionIndex: number,
    patch: Partial<ElementCondition>,
  ) => {
    onUpdateRule(ruleId, {
      groups: ruleGroups(ruleId).map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              conditions: group.conditions.map((condition, conditionIdx) =>
                conditionIdx === conditionIndex ? { ...condition, ...patch } : condition,
              ),
            }
          : group,
      ),
    })
  }

  const addCondition = (ruleId: string) => {
    onUpdateRule(ruleId, {
      groups: ruleGroups(ruleId).map((group, index) =>
        index === 0
          ? {
              ...group,
              conditions: [
                ...group.conditions,
                { operator: 'empty', operandKey: firstOperandKey ?? '', value: null },
              ],
            }
          : group,
      ),
    })
  }

  const addGroup = (ruleId: string) => {
    const current = ruleGroups(ruleId)
    onUpdateRule(ruleId, {
      groups: [...current, { groupIndex: current.length, conditions: [] }],
    })
  }

  function ruleGroups(ruleId: string) {
    return rules.find((rule) => rule.id === ruleId)?.groups ?? []
  }

  return (
    <section>
      <Card>
        <CardHeader>
          <SectionHeading level={3}>Conditional visibility</SectionHeading>
        </CardHeader>
        <CardContent className="grid gap-2">
          {rules.map((rule) => (
            <div key={rule.id} className="grid gap-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Field>
                  <FieldTriggerLabel id={`condition-effect-${rule.id}`}>Effect</FieldTriggerLabel>
                  <Select
                    value={rule.effect}
                    onValueChange={(effect) =>
                      onUpdateRule(rule.id, { effect: effect as ConditionEffect })
                    }
                  >
                    <SelectTrigger aria-labelledby={`condition-effect-${rule.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITION_EFFECTS.map((effect) => (
                        <SelectItem key={effect} value={effect}>
                          {effect}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addCondition(rule.id)}
                  >
                    Add condition
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addGroup(rule.id)}
                  >
                    Add group
                  </Button>
                </div>
              </div>
              {rule.groups.map((group, groupIndex) => (
                <div key={`${rule.id}-group-${groupIndex}`} className="grid gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Group {groupIndex + 1}
                  </p>
                  {group.conditions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No conditions in this group.</p>
                  ) : null}
                  {group.conditions.map((condition, conditionIndex) => {
                    const questionType = questionTypeFor(condition.operandKey)
                    const valueId = conditionValueKey(rule.id, groupIndex, conditionIndex)
                    const valueInvalid = invalidConditionKey === valueId
                    return (
                      <div key={valueId} className="grid gap-2 sm:grid-cols-3">
                        <Field>
                          <FieldTriggerLabel id={`condition-operand-${valueId}`}>
                            Operand
                          </FieldTriggerLabel>
                          <Select
                            value={condition.operandKey}
                            onValueChange={(operandKey) => {
                              const allowedOperators = new Set(
                                operatorOptionsFor(questionTypeFor(operandKey as ElementFieldKey)),
                              )
                              const nextOperator = allowedOperators.has(condition.operator)
                                ? condition.operator
                                : 'eq'
                              updateCondition(rule.id, groupIndex, conditionIndex, {
                                operandKey: operandKey as ElementFieldKey,
                                operator: nextOperator as ConditionOperator,
                              })
                            }}
                          >
                            <SelectTrigger aria-labelledby={`condition-operand-${valueId}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {operandOptions.map((element) => (
                                <SelectItem key={element.id} value={element.fieldKey ?? ''}>
                                  {element.label ?? element.fieldKey}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldTriggerLabel id={`condition-operator-${valueId}`}>
                            Operator
                          </FieldTriggerLabel>
                          <Select
                            value={condition.operator}
                            onValueChange={(operator) =>
                              updateCondition(rule.id, groupIndex, conditionIndex, {
                                operator: operator as ConditionOperator,
                              })
                            }
                          >
                            <SelectTrigger aria-labelledby={`condition-operator-${valueId}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {operatorOptionsFor(questionType).map((operator) => (
                                <SelectItem key={operator} value={operator}>
                                  {operator}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field invalid={valueInvalid}>
                          <FieldLabel htmlFor={`condition-value-${valueId}`}>Value</FieldLabel>
                          <Input
                            id={`condition-value-${valueId}`}
                            ref={registerValueRef(valueId)}
                            value={
                              condition.value === null || typeof condition.value === 'boolean'
                                ? ''
                                : String(condition.value)
                            }
                            onChange={(event) =>
                              updateCondition(rule.id, groupIndex, conditionIndex, {
                                value:
                                  event.target.value === ''
                                    ? null
                                    : coerceConditionValue(event.target.value),
                              })
                            }
                          />
                          {valueInvalid ? (
                            <FieldError id={`condition-value-${valueId}-error`}>
                              This condition needs a value
                            </FieldError>
                          ) : null}
                        </Field>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  )
}

function coerceConditionValue(value: string): string | number {
  const numeric = Number(value)
  return Number.isNaN(numeric) || value.trim() === '' ? value : numeric
}
