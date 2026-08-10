import type { AnswerMap, AnswerValue } from './answers.ts'
import type { FormVersionContent } from './form-version.ts'

/** Render a stored answer the way the rest of the product already prints one. */
export function answerText(value: AnswerValue | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

export interface PublicSessionFacets {
  readonly format: string
  readonly description: string
}

/**
 * Format and abstract for a public session, read from the form definition
 * rather than hardcoded keys. Format is the first `optionsSource === 'format'`
 * element (then fieldKey `format`). Description is the first `long_text` in
 * page-then-element position order.
 */
export function publicSessionFacets(
  content: FormVersionContent,
  answers: AnswerMap,
): PublicSessionFacets {
  const pagePosition = new Map(content.pages.map((page) => [page.id, page.position]))
  const elements = content.elements.toSorted((left, right) => {
    const pageDelta = (pagePosition.get(left.pageId) ?? 0) - (pagePosition.get(right.pageId) ?? 0)
    return pageDelta !== 0 ? pageDelta : left.position - right.position
  })
  const formatElement =
    elements.find((element) => element.optionsSource === 'format') ??
    elements.find((element) => element.fieldKey === 'format')
  const longText = elements.find((element) => element.questionType === 'long_text')
  const formatKey = formatElement?.fieldKey ?? 'format'
  return {
    format: answerText(answers[formatKey]),
    description:
      longText?.fieldKey === null || longText?.fieldKey === undefined
        ? ''
        : answerText(answers[longText.fieldKey]),
  }
}

export function jobTitleFromAnswers(answers: AnswerMap): string {
  return answerText(answers.job_title)
}

export function companyFromAnswers(answers: AnswerMap): string {
  return answerText(answers.company)
}
