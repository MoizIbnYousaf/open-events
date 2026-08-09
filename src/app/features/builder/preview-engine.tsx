import { useEffect, useMemo, useRef, useState } from 'react'

import type { TaxonomyItemDto } from '../../../application'
import type {
  AnswerMap,
  AnswerValue,
  ElementFieldKey,
  FormElement,
  FormVersionContent,
} from '../../../domain'
import { applyRoutingRules, isElementRequired, isElementVisible } from '../../../domain/rules'
import {
  validateAnswersAgainstVersion,
  type AnswerValidationIssue,
} from '../../../domain/invariants/submission'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'

interface PreviewEngineProps {
  readonly content: FormVersionContent
  readonly taxonomyItems: readonly TaxonomyItemDto[]
}

export default function PreviewEngine({ content, taxonomyItems }: PreviewEngineProps) {
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [issues, setIssues] = useState<readonly AnswerValidationIssue[]>([])
  const fieldRefs = useRef(new Map<ElementFieldKey, HTMLElement | null>())

  const visibleElements = useMemo(
    () =>
      content.elements.filter((element) =>
        isElementVisible(element, content.conditionRules, answers),
      ),
    [content, answers],
  )

  const routingOutcome = useMemo(
    () => applyRoutingRules(content.routingRules, answers),
    [content.routingRules, answers],
  )
  const routingLabel = useMemo(() => {
    if (routingOutcome === null || routingOutcome.actionTarget === null) return null
    return (
      taxonomyItems.find((item) => item.key === routingOutcome.actionTarget)?.label ??
      routingOutcome.actionTarget
    )
  }, [routingOutcome, taxonomyItems])

  useEffect(() => {
    const first = content.elements.find(
      (element) =>
        element.fieldKey !== null && (element.kind === 'field' || element.kind === 'question'),
    )
    if (first?.fieldKey !== null && first?.fieldKey !== undefined) {
      fieldRefs.current.get(first.fieldKey)?.focus()
    }
  }, [content])

  const setAnswer = (fieldKey: ElementFieldKey, value: AnswerValue | null) => {
    setAnswers((current) => ({ ...current, [fieldKey]: value }))
  }

  const submit = () => {
    const next = validateAnswersAgainstVersion(content, answers)
    setIssues(next)
    if (next.length > 0) {
      const first = next[0]
      if (first !== undefined) {
        fieldRefs.current.get(first.fieldKey)?.focus()
      }
    }
  }

  const registerFieldRef =
    <T extends HTMLElement>(fieldKey: ElementFieldKey) =>
    (node: T | null) => {
      if (node === null) {
        fieldRefs.current.delete(fieldKey)
      } else {
        fieldRefs.current.set(fieldKey, node)
      }
    }

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {visibleElements.map((element) =>
          element.fieldKey === null ? (
            <p key={element.id} className="text-sm font-medium">
              {element.label}
            </p>
          ) : (
            <PreviewField
              key={element.id}
              element={element}
              answers={answers}
              required={isElementRequired(element, content.conditionRules, answers)}
              registerFieldRef={registerFieldRef}
              onChange={(value) => setAnswer(element.fieldKey as ElementFieldKey, value)}
            />
          ),
        )}
        {issues.length > 0 ? <AlertLive>Please review the highlighted fields.</AlertLive> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit">Submit preview</Button>
          {routingLabel !== null ? (
            <p className="text-sm font-medium text-muted-foreground">{routingLabel}</p>
          ) : null}
        </div>
      </form>
    </div>
  )
}

interface PreviewFieldProps {
  readonly element: FormElement
  readonly answers: AnswerMap
  readonly required: boolean
  readonly registerFieldRef: <T extends HTMLElement>(
    fieldKey: ElementFieldKey,
  ) => (node: T | null) => void
  readonly onChange: (value: AnswerValue | null) => void
}

function PreviewField({
  element,
  answers,
  required,
  registerFieldRef,
  onChange,
}: PreviewFieldProps) {
  const fieldKey = element.fieldKey
  if (fieldKey === null) return null
  const label = element.label ?? fieldKey
  const value = answers[fieldKey]
  const id = `preview-field-${fieldKey}`
  const baseFieldClass =
    'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none disabled:opacity-50 md:text-sm'

  if (element.questionType === 'long_text') {
    return (
      <div className="grid gap-1.5">
        <label htmlFor={id}>{label}</label>
        <textarea
          id={id}
          ref={registerFieldRef(fieldKey)}
          required={required}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className={`${baseFieldClass} min-h-24 resize-y`}
        />
      </div>
    )
  }
  if (element.questionType === 'single_choice') {
    return (
      <div className="grid gap-1.5">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          ref={registerFieldRef(fieldKey) as (node: HTMLSelectElement | null) => void}
          required={required}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className={baseFieldClass}
        >
          <option value="">Select…</option>
          {element.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    )
  }
  if (element.questionType === 'multi_choice') {
    return (
      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">{label}</legend>
        {element.options.map((option) => {
          const selected = Array.isArray(value) && value.includes(option)
          return (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                required={required && element.options.length > 0 && !selected}
                checked={selected}
                onChange={(event) => {
                  const current = Array.isArray(value) ? (value as string[]) : []
                  onChange(
                    event.target.checked
                      ? [...current, option]
                      : current.filter((item) => item !== option),
                  )
                }}
              />
              {option}
            </label>
          )
        })}
      </fieldset>
    )
  }
  const inputType =
    element.questionType === 'number'
      ? 'number'
      : element.questionType === 'email'
        ? 'email'
        : 'text'
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        ref={registerFieldRef(fieldKey)}
        type={inputType}
        required={required}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) =>
          onChange(inputType === 'number' ? Number(event.target.value) : event.target.value)
        }
      />
    </div>
  )
}
