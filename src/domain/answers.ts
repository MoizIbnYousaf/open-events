export type AnswerValue = string | number | boolean | readonly string[]

/** Submitted answers keyed by `ElementFieldKey`; missing keys mean unanswered. */
export type AnswerMap = Readonly<Record<string, AnswerValue | null>>

export function getAnswer(answers: AnswerMap, fieldKey: string): AnswerValue | null {
  return answers[fieldKey] ?? null
}

/** An answer counts as empty when absent, null, whitespace-only, or an empty list. */
export function isValueEmpty(value: AnswerValue | null | undefined): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}
