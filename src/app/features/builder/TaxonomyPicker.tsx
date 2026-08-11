import { useId } from 'react'

import type { TaxonomyItemDto } from '../../../application'
import type { TaxonomyKey, TaxonomyKind } from '../../../domain'
import { Field, FieldTriggerLabel } from '../../../components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'

interface TaxonomyPickerProps {
  readonly kind: TaxonomyKind
  readonly items: readonly TaxonomyItemDto[]
  readonly value: TaxonomyKey | null
  readonly onChange: (value: TaxonomyKey | null) => void
}

/**
 * One routing rule's target picker. The label id is generated per instance:
 * this component is rendered once per routing rule, and a hardcoded id
 * previously made every trigger's aria-labelledby resolve to the first rule's
 * label, so rules 2..n were effectively unlabelled.
 */
export default function TaxonomyPicker({ kind, items, value, onChange }: TaxonomyPickerProps) {
  const options = items.filter((item) => item.kind === kind)
  const labelId = useId()
  return (
    <Field>
      <FieldTriggerLabel id={labelId}>Target</FieldTriggerLabel>
      <Select value={value ?? ''} onValueChange={(next) => onChange(next === '' ? null : next)}>
        <SelectTrigger aria-labelledby={labelId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.key} value={item.key}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
