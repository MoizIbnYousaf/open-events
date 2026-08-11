import type { FormElement } from '../../../domain'
import { Checkbox } from '../../../components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'

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
    </div>
  )
}
