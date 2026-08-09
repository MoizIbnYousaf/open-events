import { getAnswer, isValueEmpty, type AnswerMap } from '../answers.ts'
import type { ElementFieldKey, FormElement, FormVersionContent } from '../form-version.ts'
import { isElementRequired, isElementVisible } from '../rules.ts'
import { isValidEmailAddress } from './email.ts'

export const ANSWER_ISSUE_CODES = [
  'unknown_field',
  'missing_required',
  'invalid_type',
  'exceeds_max_length',
  'hidden_field_submitted',
  'invalid_option',
] as const

export type AnswerIssueCode = (typeof ANSWER_ISSUE_CODES)[number]

export interface AnswerValidationIssue {
  readonly code: AnswerIssueCode
  readonly fieldKey: ElementFieldKey
  readonly message: string
}

/**
 * Server-side re-evaluation of a submitted answer snapshot: unknown fields are
 * rejected, hidden-field tampering is rejected, visible required fields must be
 * answered, and values are type/option/length checked against the version.
 */
export function validateAnswersAgainstVersion(
  content: FormVersionContent,
  answers: AnswerMap,
): readonly AnswerValidationIssue[] {
  const issues: AnswerValidationIssue[] = []
  const elementsByFieldKey = new Map<ElementFieldKey, FormElement>()
  for (const element of content.elements) {
    if (element.fieldKey !== null) elementsByFieldKey.set(element.fieldKey, element)
  }

  for (const fieldKey of Object.keys(answers)) {
    if (!elementsByFieldKey.has(fieldKey)) {
      issues.push({ code: 'unknown_field', fieldKey, message: `Unknown form field '${fieldKey}'` })
    }
  }

  for (const [fieldKey, element] of elementsByFieldKey) {
    const visible = isElementVisible(element, content.conditionRules, answers)
    const required = isElementRequired(element, content.conditionRules, answers)
    const value = getAnswer(answers, fieldKey)
    if (!visible) {
      if (!isValueEmpty(value)) {
        issues.push({
          code: 'hidden_field_submitted',
          fieldKey,
          message: `Field '${fieldKey}' is hidden by form rules and must not be submitted`,
        })
      }
      continue
    }
    if (required && isValueEmpty(value)) {
      issues.push({
        code: 'missing_required',
        fieldKey,
        message: `Field '${fieldKey}' is required`,
      })
    }
    if (isValueEmpty(value)) continue
    const typeIssue = validateAnswerType(element, value)
    if (typeIssue !== null) issues.push(typeIssue)
    if (
      typeof value === 'string' &&
      element.maxLength !== null &&
      value.length > element.maxLength
    ) {
      issues.push({
        code: 'exceeds_max_length',
        fieldKey,
        message: `Field '${fieldKey}' exceeds the maximum length of ${element.maxLength}`,
      })
    }
  }
  return issues
}

function validateAnswerType(element: FormElement, value: unknown): AnswerValidationIssue | null {
  const fieldKey = element.fieldKey ?? ''
  if (element.questionType === null) return null
  switch (element.questionType) {
    case 'short_text':
    case 'long_text':
      return typeof value === 'string'
        ? null
        : { code: 'invalid_type', fieldKey, message: `Field '${fieldKey}' must be text` }
    case 'email':
      if (typeof value !== 'string' || !isValidEmailAddress(value)) {
        return {
          code: 'invalid_type',
          fieldKey,
          message: `Field '${fieldKey}' must be a valid email address`,
        }
      }
      return null
    case 'number':
      return typeof value === 'number'
        ? null
        : { code: 'invalid_type', fieldKey, message: `Field '${fieldKey}' must be a number` }
    case 'single_choice':
      if (typeof value !== 'string') {
        return {
          code: 'invalid_type',
          fieldKey,
          message: `Field '${fieldKey}' must be a single option`,
        }
      }
      if (element.options.length > 0 && !element.options.includes(value)) {
        return {
          code: 'invalid_option',
          fieldKey,
          message: `Field '${fieldKey}' has an unknown option`,
        }
      }
      return null
    case 'multi_choice':
      if (!Array.isArray(value)) {
        return {
          code: 'invalid_type',
          fieldKey,
          message: `Field '${fieldKey}' must be a list of options`,
        }
      }
      if (element.options.length > 0) {
        for (const option of value) {
          if (typeof option !== 'string' || !element.options.includes(option)) {
            return {
              code: 'invalid_option',
              fieldKey,
              message: `Field '${fieldKey}' has an unknown option`,
            }
          }
        }
      }
      return null
  }
}
