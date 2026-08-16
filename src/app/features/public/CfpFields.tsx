import type { ReactNode } from 'react'

import type { FormElementDto } from '../../../application'
import type { AnswerValue } from '../../../domain'
import { autocompleteForElement } from '../../lib/autocomplete-purpose'
import { Checkbox } from '../../../components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { Textarea } from '../../../components/ui/textarea'

interface CfpFieldsProps {
  readonly element: FormElementDto
  readonly domId: string
  readonly value: AnswerValue | null | undefined
  readonly required?: boolean
  readonly error?: string
  readonly ariaControls?: string
  readonly inputRef?: (node: HTMLElement | null) => void
  readonly onChange: (value: AnswerValue) => void
}

/**
 * The label row every speaker-facing field uses: the caller's own `FieldLabel`
 * plus the one required marker.
 *
 * The mark sits BESIDE the `<label>`, never inside it: the label element's text
 * is the field's accessible name, and a name that ended in a star would be read
 * aloud as one. `aria-hidden` for the same reason — the control already carries
 * `required`, which is what assistive tech announces, so the mark is for the
 * eye alone. A mandatory field that looks exactly like an optional one is only
 * discoverable by being bounced out of the step.
 *
 * It wraps the label rather than replacing it, so the `<FieldLabel htmlFor>`
 * and the control it names stay side by side in the caller's own source. The
 * earlier `CfpFieldLabel` swallowed the label element, which left every field
 * on this page looking, to anything reading the markup statically, like a
 * control with no label at all (shadscan/forms-have-labels).
 */
export function CfpFieldLabelRow({
  required,
  children,
}: {
  readonly required: boolean
  readonly children: ReactNode
}) {
  return (
    <span className="flex items-baseline">
      {children}
      {required ? (
        <span aria-hidden="true" data-slot="required-mark" className="ml-0.5 text-destructive">
          *
        </span>
      ) : null}
    </span>
  )
}

const RING_RADIUS = 6
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** The gauge stays away until the limit is close enough to matter. */
const METER_THRESHOLD = 0.8

/**
 * A budget the writer only sees once it is nearly spent. A counter that is
 * always on turns a proposal box into a form to satisfy; one that appears in
 * the last fifth of the allowance is a warning arriving when it is useful.
 *
 * Hidden from assistive tech on purpose: `maxLength` already tells a screen
 * reader the limit, and a number that changes on every keystroke inside a live
 * form is noise, not information.
 */
function CharacterMeter({ used, max }: { readonly used: number; readonly max: number }) {
  if (max <= 0 || used < max * METER_THRESHOLD) return null
  const ratio = Math.min(1, used / max)
  const remaining = Math.max(0, max - used)
  return (
    <span
      aria-hidden="true"
      className="flex items-center gap-1.5 justify-self-end text-xs tabular-nums text-muted-foreground"
    >
      <svg viewBox="0 0 16 16" className="size-4 -rotate-90" focusable="false">
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2"
          className="stroke-border-opaque"
        />
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - ratio)}
          className={remaining === 0 ? 'stroke-destructive' : 'stroke-primary'}
        />
      </svg>
      {remaining} left
    </span>
  )
}

export default function CfpFields({
  element,
  domId,
  value,
  required = false,
  error,
  ariaControls,
  inputRef,
  onChange,
}: CfpFieldsProps) {
  const label = element.label ?? 'Question'
  const errorId = `${domId}-error`
  const stringValue = typeof value === 'string' ? value : ''
  const maxLength = element.maxLength ?? undefined
  const autoComplete = autocompleteForElement(element)
  const invalid = error !== undefined
  const invalidProps = {
    'aria-invalid': invalid ? true : undefined,
    'aria-describedby': invalid ? errorId : undefined,
    'aria-controls': ariaControls,
  }
  const errorNode = invalid ? <FieldError id={errorId}>{error}</FieldError> : null

  if (element.questionType === 'long_text') {
    return (
      <Field invalid={invalid}>
        <CfpFieldLabelRow required={required}>
          <FieldLabel htmlFor={domId}>{label}</FieldLabel>
        </CfpFieldLabelRow>
        <Textarea
          id={domId}
          ref={inputRef as (node: HTMLTextAreaElement | null) => void}
          value={stringValue}
          required={required}
          maxLength={maxLength}
          {...invalidProps}
          onChange={(event) => onChange(event.target.value)}
        />
        {maxLength !== undefined ? (
          <CharacterMeter used={stringValue.length} max={maxLength} />
        ) : null}
        {errorNode}
      </Field>
    )
  }

  if (element.questionType === 'single_choice') {
    return (
      <Field invalid={invalid}>
        <CfpFieldLabelRow required={required}>
          <FieldLabel htmlFor={domId}>{label}</FieldLabel>
        </CfpFieldLabelRow>
        {/* A real `<select>`, not the Base UI combobox. The published journey
            drives this control with `selectOption` / `selectOptions`, which
            only speak to a native select, and the answer is a plain string the
            form engine already understands. Swapping in a listbox would buy
            styling and cost the contract. */}
        <NativeSelect
          id={domId}
          ref={inputRef as (node: HTMLSelectElement | null) => void}
          value={stringValue}
          required={required}
          {...invalidProps}
          onChange={(event) => onChange(event.target.value)}
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
    const selected = Array.isArray(value) ? (value as readonly string[]) : []
    const selectedOptions = new Set(selected)
    // A <fieldset> is not a form control: aria-invalid / aria-describedby on it
    // are not reliably surfaced. The state belongs on each checkbox, which is
    // what a screen-reader user actually lands on.
    return (
      <Field
        render={<fieldset />}
        invalid={invalid}
        id={domId}
        aria-controls={ariaControls}
        aria-required={required ? true : undefined}
        className="grid gap-1.5"
      >
        <legend className="mb-1.5 flex items-baseline text-xs font-medium text-muted-foreground">
          {label}
          {required ? (
            <span aria-hidden="true" data-slot="required-mark" className="ml-0.5 text-destructive">
              *
            </span>
          ) : null}
        </legend>
        <div className="grid gap-1.5">
          {element.options.map((option, index) => {
            const optionId = `${domId}-option-${index}`
            return (
              <label
                key={option}
                htmlFor={optionId}
                className="flex w-fit cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  id={optionId}
                  ref={
                    index === 0 ? (inputRef as (node: HTMLInputElement | null) => void) : undefined
                  }
                  checked={selectedOptions.has(option)}
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={invalid ? errorId : undefined}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option]
                        : selected.filter((item) => item !== option),
                    )
                  }
                />
                {option}
              </label>
            )
          })}
        </div>
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
      <CfpFieldLabelRow required={required}>
        <FieldLabel htmlFor={domId}>{label}</FieldLabel>
      </CfpFieldLabelRow>
      <Input
        id={domId}
        ref={inputRef as (node: HTMLInputElement | null) => void}
        type={inputType}
        value={stringValue}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        {...invalidProps}
        onChange={(event) =>
          onChange(
            inputType === 'number' && event.target.value !== ''
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
      {maxLength !== undefined && inputType === 'text' ? (
        <CharacterMeter used={stringValue.length} max={maxLength} />
      ) : null}
      {errorNode}
    </Field>
  )
}
