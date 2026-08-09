import type {
  ConditionEffect,
  ConditionOperator,
  ElementCondition,
  ElementFieldKey,
  ElementRule,
  FormElement,
  QuestionType,
} from '../../../domain'
import { CONDITION_EFFECTS } from '../../../domain'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'

import { conditionValueKey, operatorOptionsFor } from './builder-model'

interface ConditionRuleEditorProps {
  readonly rules: readonly ElementRule[]
  readonly elements: readonly FormElement[]
  readonly registerValueRef: (key: string) => (node: HTMLInputElement | null) => void
  readonly onUpdateRule: (ruleId: string, patch: Partial<ElementRule>) => void
}

export default function ConditionRuleEditor({
  rules,
  elements,
  registerValueRef,
  onUpdateRule,
}: ConditionRuleEditorProps) {
  if (rules.length === 0) {
    return (
      <section className="grid gap-2 rounded-lg border p-3">
        <h3 className="text-sm font-semibold">Conditional visibility</h3>
        <p className="text-sm text-muted-foreground">No conditional rules yet.</p>
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
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">Conditional visibility</h3>
      {rules.map((rule) => (
        <div key={rule.id} className="grid gap-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Effect</span>
              <Select
                value={rule.effect}
                onValueChange={(effect) =>
                  onUpdateRule(rule.id, { effect: effect as ConditionEffect })
                }
              >
                <SelectTrigger aria-label="Effect">
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
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addCondition(rule.id)}
              >
                Add condition
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addGroup(rule.id)}>
                Add group
              </Button>
            </div>
          </div>
          {rule.groups.map((group, groupIndex) => (
            <div key={`${rule.id}-group-${groupIndex}`} className="grid gap-2">
              <p className="text-xs font-medium text-muted-foreground">Group {groupIndex + 1}</p>
              {group.conditions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conditions in this group.</p>
              ) : null}
              {group.conditions.map((condition, conditionIndex) => {
                const questionType = questionTypeFor(condition.operandKey)
                const valueId = conditionValueKey(rule.id, groupIndex, conditionIndex)
                return (
                  <div key={valueId} className="grid gap-2 sm:grid-cols-3">
                    <Select
                      value={condition.operandKey}
                      onValueChange={(operandKey) => {
                        const nextOperator = operatorOptionsFor(
                          questionTypeFor(operandKey as ElementFieldKey),
                        ).includes(condition.operator)
                          ? condition.operator
                          : 'eq'
                        updateCondition(rule.id, groupIndex, conditionIndex, {
                          operandKey: operandKey as ElementFieldKey,
                          operator: nextOperator as ConditionOperator,
                        })
                      }}
                    >
                      <SelectTrigger aria-label="Operand">
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
                    <Select
                      value={condition.operator}
                      onValueChange={(operator) =>
                        updateCondition(rule.id, groupIndex, conditionIndex, {
                          operator: operator as ConditionOperator,
                        })
                      }
                    >
                      <SelectTrigger aria-label="Operator">
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
                    <div className="grid gap-1.5">
                      <label htmlFor={`condition-value-${valueId}`}>Value</label>
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
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

function coerceConditionValue(value: string): string | number {
  const numeric = Number(value)
  return Number.isNaN(numeric) || value.trim() === '' ? value : numeric
}
