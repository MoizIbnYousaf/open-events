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
import { Checkbox } from '../../../components/ui/checkbox'
import { StatusLive } from '../../../components/ui/status-live'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { Textarea } from '../../../components/ui/textarea'
import { autocompleteForElement } from '../../lib/autocomplete-purpose'

interface PreviewEngineProps {
  readonly content: FormVersionContent
  readonly taxonomyItems: readonly TaxonomyItemDto[]
}

export default function PreviewEngine({ content, taxonomyItems }: PreviewEngineProps) {
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [issues, setIssues] = useState<readonly AnswerValidationIssue[]>([])
  // A clean run used to change nothing on screen, so the organizer could not
  // tell the check had happened at all.
  const [passed, setPassed] = useState(false)
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
    setPassed(false)
    setAnswers((current) => ({ ...current, [fieldKey]: value }))
  }

  // Synchronous, local, and deliberately so: the preview never talks to the
  // server, it re-runs the same domain validation the real submit would.
  const checkAnswers = () => {
    const next = validateAnswersAgainstVersion(content, answers)
    setIssues(next)
    setPassed(next.length === 0)
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

  // The engine already computed a field-precise issue for every problem; it
  // used to render only "Please review the highlighted fields." and highlight
  // nothing. Indexing by fieldKey is what lets each control carry its own text.
  const issueByField = new Map(issues.map((issue) => [issue.fieldKey, issue.message]))

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-4"
        noValidate
        onSubmitCapture={(event) => {
          event.preventDefault()
          checkAnswers()
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
              error={issueByField.get(element.fieldKey)}
              registerFieldRef={registerFieldRef}
              onChange={(value) => setAnswer(element.fieldKey as ElementFieldKey, value)}
            />
          ),
        )}
        {issues.length > 0 ? <AlertLive>Please review the highlighted fields.</AlertLive> : null}
        {/* Mounted with the form and empty until a check passes: a region
            whose text changes, never one created together with its text — a
            polite live region has to be in the accessibility tree before its
            content arrives or it announces nothing (DEC-014). */}
        <StatusLive aria-live="polite">
          {passed ? 'No problems found in these answers.' : null}
        </StatusLive>
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
  readonly error: string | undefined
  readonly registerFieldRef: <T extends HTMLElement>(
    fieldKey: ElementFieldKey,
  ) => (node: T | null) => void
  readonly onChange: (value: AnswerValue | null) => void
}

function PreviewField({
  element,
  answers,
  required,
  error,
  registerFieldRef,
  onChange,
}: PreviewFieldProps) {
  const fieldKey = element.fieldKey
  if (fieldKey === null) return null
  const label = element.label ?? fieldKey
  const value = answers[fieldKey]
  const id = `preview-field-${fieldKey}`
  const errorId = `${id}-error`
  const invalid = error !== undefined
  const errorNode = invalid ? <FieldError id={errorId}>{error}</FieldError> : null

  if (element.questionType === 'long_text') {
    return (
      <Field invalid={invalid}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Textarea
          id={id}
          aria-label={label}
          ref={registerFieldRef(fieldKey)}
          required={required}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {errorNode}
      </Field>
    )
  }
  if (element.questionType === 'single_choice') {
    // The same control the speaker will actually meet: `CfpFields` renders a
    // native select for this question type, and a preview that showed a
    // composite listbox instead would be previewing a form that does not
    // exist. Parity is the whole job of this surface, so the platform control
    // wins over the prettier one — and it takes a real `<label for>` with it.
    return (
      <Field invalid={invalid}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <NativeSelect
          id={id}
          // `HTMLSelectElement` does not structurally satisfy `HTMLElement`
          // under this lib (its `remove(index)` overload collides with
          // `ChildNode.remove`), so the shared registrar is narrowed at the
          // call site exactly as `CfpFields` narrows its own.
          ref={registerFieldRef(fieldKey) as (node: HTMLSelectElement | null) => void}
          required={required}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => onChange(event.target.value as AnswerValue)}
        >
          <option value="">Select…</option>
          {element.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </NativeSelect>
        {errorNode}
      </Field>
    )
  }
  if (element.questionType === 'multi_choice') {
    const selectedOptions = new Set(Array.isArray(value) ? value : [])
    return (
      <Field invalid={invalid}>
        <fieldset className="grid gap-1">
          <legend className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</legend>
          {element.options.map((option, index) => {
            const selected = selectedOptions.has(option)
            const optionId = `${id}-option-${index}`
            return (
              <label key={option} htmlFor={optionId} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  id={optionId}
                  required={required && element.options.length > 0 && !selected}
                  checked={selected}
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={invalid ? errorId : undefined}
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
        {errorNode}
      </Field>
    )
  }
  const inputType =
    element.questionType === 'number'
      ? 'number'
      : element.questionType === 'email'
        ? 'email'
        : 'text'
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        ref={registerFieldRef(fieldKey)}
        type={inputType}
        required={required}
        autoComplete={autocompleteForElement(element)}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) =>
          onChange(inputType === 'number' ? Number(event.target.value) : event.target.value)
        }
      />
      {errorNode}
    </Field>
  )
}
