import type { TaxonomyItemDto } from '../../../application'
import type { AnswerMap, FormVersionContent } from '../../../domain'
import { isElementRequired, isElementVisible } from '../../../domain/rules'
import BasePreviewEngine from './preview-engine-base'

interface PreviewEngineProps {
  readonly content: FormVersionContent
  readonly taxonomyItems: readonly TaxonomyItemDto[]
  readonly autoFocus?: boolean
  readonly labelled?: boolean
}

const EMPTY_ANSWERS: AnswerMap = {}

/**
 * The sidebar is a visual sketch, not a second operable form. The dialog keeps
 * the full interactive engine; the inert sidebar uses placeholders and creates
 * no duplicate control ids or focus targets.
 */
export default function PreviewEngine({
  content,
  taxonomyItems,
  autoFocus = false,
  labelled = true,
}: PreviewEngineProps) {
  if (labelled) {
    return (
      <BasePreviewEngine
        content={content}
        taxonomyItems={taxonomyItems}
        autoFocus={autoFocus}
        labelled
      />
    )
  }

  const visibleElements = content.elements.filter((element) =>
    isElementVisible(element, content.conditionRules, EMPTY_ANSWERS),
  )
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-xs">
      {visibleElements.map((element) => (
        <div key={element.id} className="grid gap-1">
          <p className="text-sm font-medium text-foreground">
            {element.label ?? element.fieldKey}
            {element.fieldKey !== null &&
            isElementRequired(element, content.conditionRules, EMPTY_ANSWERS) ? (
              <span className="text-destructive"> *</span>
            ) : null}
          </p>
          {element.fieldKey !== null ? (
            <div className="h-8 rounded-md border border-input bg-background" />
          ) : null}
        </div>
      ))}
    </div>
  )
}
