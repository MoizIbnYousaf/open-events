import type { FormElement } from '../../../domain'
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
  return (
    <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <label htmlFor={labelId}>Label</label>
        <Input
          id={labelId}
          ref={labelRef}
          value={element.label ?? ''}
          aria-invalid={invalid || undefined}
          onChange={(event) => onUpdate({ label: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={keyId}>Field key</label>
        <Input
          id={keyId}
          value={element.fieldKey ?? ''}
          onChange={(event) =>
            onUpdate({ fieldKey: event.target.value === '' ? null : event.target.value })
          }
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={element.required}
          onChange={(event) => onUpdate({ required: event.target.checked })}
        />
        Required
      </label>
    </div>
  )
}
