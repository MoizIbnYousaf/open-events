import type { FormDefinitionDto } from '../../../application'
import type { AnswerMap, AnswerValue } from '../../../domain'
import { isElementVisibleDto } from '../../lib/form-engine'

interface CfpReviewSummaryProps {
  readonly form: FormDefinitionDto
  readonly title: string
  readonly answers: AnswerMap
  /**
   * The step the summary is rendered on. Its own questions are left out: a
   * review page is allowed to ask something itself, and listing an answer
   * directly above the control still asking for it reads as a contradiction.
   */
  readonly currentPageId: string
}

const NOT_ANSWERED = 'Not answered'

/** One answer as the speaker typed it, never a raw `[object Object]`. */
function formatAnswer(value: AnswerValue | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string')
    return items.length === 0 ? null : items.join(', ')
  }
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const text = String(value).trim()
  return text.length === 0 ? null : text
}

/**
 * What the speaker is about to send.
 *
 * The final step used to say "Review your answers and submit" above nothing at
 * all — the one screen whose entire job is to show the answers showed none of
 * them, and the only way to check a proposal before submitting it was to walk
 * back through every step.
 *
 * It reads from the same visibility rules the wizard renders with, so a
 * question hidden by a condition is absent here too: a summary that listed
 * questions the speaker was never asked would be a different kind of lie.
 */
export default function CfpReviewSummary({
  form,
  title,
  answers,
  currentPageId,
}: CfpReviewSummaryProps) {
  const pages = form.pages
    .filter((page) => page.id !== currentPageId)
    .toSorted((a, b) => a.position - b.position)
  const answered = pages.flatMap((page) =>
    form.elements
      .filter(
        (element) =>
          element.pageId === page.id &&
          element.fieldKey !== null &&
          isElementVisibleDto(element, form.conditionRules, answers),
      )
      .toSorted((a, b) => a.position - b.position)
      .map((element) => ({
        id: element.id,
        label: element.label ?? 'Question',
        value: element.fieldKey === null ? null : formatAnswer(answers[element.fieldKey]),
      })),
  )
  const hasTitleQuestion = form.elements.some((element) => element.fieldKey === 'title')
  const rows = hasTitleQuestion
    ? answered
    : [{ id: 'proposal-title', label: 'Proposal title', value: formatAnswer(title) }, ...answered]

  return (
    <dl className="grid gap-3 rounded-lg p-3 ring-1 ring-border">
      {rows.map((row) => (
        <div key={row.id} className="grid gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd
            className={
              row.value === null ? 'text-sm text-muted-foreground italic' : 'text-sm break-words'
            }
          >
            {row.value ?? NOT_ANSWERED}
          </dd>
        </div>
      ))}
    </dl>
  )
}
