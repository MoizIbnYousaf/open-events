import type { TaxonomyItemDto } from '../../../application'
import type { TaxonomyKey, TaxonomyKind } from '../../../domain'
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

export default function TaxonomyPicker({ kind, items, value, onChange }: TaxonomyPickerProps) {
  const options = items.filter((item) => item.kind === kind)
  return (
    <div className="grid gap-1.5">
      <span id="routing-target-label" className="text-sm font-medium">
        Target
      </span>
      <Select value={value ?? ''} onValueChange={(next) => onChange(next === '' ? null : next)}>
        <SelectTrigger aria-labelledby="routing-target-label">
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
    </div>
  )
}
