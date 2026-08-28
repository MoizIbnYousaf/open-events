import type {
  SubmissionFacetDto,
  SubmissionFacetSelection,
} from '../../../application/dtos/submission-desk.dto'
import { Button } from '../../../components/ui/button'

function valuesFor(
  selections: readonly SubmissionFacetSelection[],
  elementId: string,
): readonly string[] {
  return selections.find((selection) => selection.elementId === elementId)?.values ?? []
}

function updateSelection(
  selections: readonly SubmissionFacetSelection[],
  elementId: string,
  value: string,
  checked: boolean,
): readonly SubmissionFacetSelection[] {
  const nextValues = new Set(valuesFor(selections, elementId))
  if (checked) nextValues.add(value)
  else nextValues.delete(value)
  const withoutFacet = selections.filter((selection) => selection.elementId !== elementId)
  if (nextValues.size === 0) return withoutFacet
  return [
    ...withoutFacet,
    { elementId, values: [...nextValues].sort((left, right) => left.localeCompare(right, 'en')) },
  ].sort((left, right) => left.elementId.localeCompare(right.elementId, 'en'))
}

export function SubmissionFacetFilters({
  facets,
  selections,
  onChange,
}: {
  readonly facets: readonly SubmissionFacetDto[]
  readonly selections: readonly SubmissionFacetSelection[]
  readonly onChange: (selections: readonly SubmissionFacetSelection[]) => void
}) {
  if (facets.length === 0) return null
  const selectedCount = selections.reduce((total, selection) => total + selection.values.length, 0)
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium outline-hidden marker:hidden hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
        Answer filters{selectedCount > 0 ? ` (${selectedCount})` : ''}
        <span aria-hidden="true" className="ml-auto text-muted-foreground group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2 xl:grid-cols-3">
        {facets.map((facet) => (
          <fieldset key={facet.elementId} className="grid content-start gap-1.5">
            <legend className="mb-1 text-sm font-medium">
              {facet.formSlug} · {facet.label}
            </legend>
            {facet.options.map((option) => (
              <label
                key={option.value}
                className="flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={valuesFor(selections, facet.elementId).includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      updateSelection(
                        selections,
                        facet.elementId,
                        option.value,
                        event.currentTarget.checked,
                      ),
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate">{option.value}</span>
                <span className="tabular-nums text-muted-foreground">{option.count}</span>
              </label>
            ))}
          </fieldset>
        ))}
        {selectedCount > 0 ? (
          <div className="self-end">
            <Button type="button" variant="outline" size="sm" onClick={() => onChange([])}>
              Clear answer filters
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  )
}
