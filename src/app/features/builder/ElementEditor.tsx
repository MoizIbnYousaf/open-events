import { useState } from 'react'

import type { FormElement, QuestionType } from '../../../domain'
import { choicesTextToOptions } from './builder-model'
import { Checkbox } from '../../../components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { Textarea } from '../../../components/ui/textarea'

const ANSWER_TYPES: readonly { readonly value: QuestionType; readonly label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'single_choice', label: 'Dropdown' },
]

interface ElementEditorProps {
  readonly element: FormElement
  readonly invalid?: boolean
  readonly labelRef?: (node: HTMLInputElement | null) => void
  readonly onUpdate: (patch: Partial<FormElement>) => void
}

export default function ElementEditor({
  element,
  invalid = false,
  labelRef,
  onUpdate,
}: ElementEditorProps) {
  const labelId = `element-label-${element.id}`
  const keyId = `element-key-${element.id}`
  const requiredId = `element-required-${element.id}`
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field invalid={invalid}>
        <FieldLabel htmlFor={labelId}>Label</FieldLabel>
        <Input
          id={labelId}
          ref={labelRef}
          value={element.label ?? ''}
          onChange={(event) => onUpdate({ label: event.target.value })}
        />
        {invalid ? <FieldError id={`${labelId}-error`}>Label is required</FieldError> : null}
      </Field>
      <Field>
        <FieldLabel htmlFor={keyId}>Field key</FieldLabel>
        <Input
          id={keyId}
          value={element.fieldKey ?? ''}
          onChange={(event) =>
            onUpdate({ fieldKey: event.target.value === '' ? null : event.target.value })
          }
        />
      </Field>
      {/* The checkbox is the product's own control now, not the platform's:
          the native one ignored every token on the screen around it. */}
      <label
        htmlFor={requiredId}
        className="flex items-center gap-2 text-sm font-medium sm:col-span-2"
      >
        <Checkbox
          id={requiredId}
          checked={element.required}
          onChange={(event) => onUpdate({ required: event.target.checked })}
        />
        Required
      </label>
      <Field>
        <FieldLabel htmlFor={`element-type-${element.id}`}>Answer type</FieldLabel>
        <NativeSelect
          id={`element-type-${element.id}`}
          value={element.questionType ?? 'short_text'}
          onChange={(event) => {
            const next = event.target.value as QuestionType
            const isChoice = next === 'single_choice' || next === 'multi_choice'
            onUpdate({
              questionType: next,
              options: isChoice && element.options.length === 0 ? ['Option 1'] : element.options,
              maxLength: next === 'long_text' ? 4000 : 200,
            })
          }}
        >
          {ANSWER_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {element.questionType === 'single_choice' || element.questionType === 'multi_choice' ? (
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`element-options-${element.id}`}>
            Choices (one per line)
          </FieldLabel>
          <ChoicesField
            key={`${element.id}:${element.questionType}`}
            id={`element-options-${element.id}`}
            options={element.options}
            onCommit={(options) => onUpdate({ options })}
          />
        </Field>
      ) : null}
    </div>
  )
}

/**
 * The choices field is a raw string while it is being typed. Parsing into
 * `options` only happens on blur, so a space, an Enter, or a half-typed word
 * cannot be rewritten out from under the caret.
 */
function ChoicesField({
  id,
  options,
  onCommit,
}: {
  readonly id: string
  readonly options: readonly string[]
  readonly onCommit: (options: readonly string[]) => void
}) {
  const [draft, setDraft] = useState(() => options.join('\n'))
  return (
    <Textarea
      id={id}
      rows={3}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(choicesTextToOptions(draft))}
    />
  )
}
