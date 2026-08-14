import { describe, expect, it } from 'vitest'

import { getAnswer, isValueEmpty, validateAnswersAgainstVersion } from '../../../src/domain'
import {
  attendeesElement,
  createContent,
  createElement,
  emailElement,
  formatElement,
  showWorkshopRule,
  titleElement,
  topicsElement,
  workshopElement,
} from '../helpers/fixtures'

const content = createContent()

describe('answer accessors', () => {
  it('returns null for missing keys and stores null answers', () => {
    expect(getAnswer({}, 'format')).toBeNull()
    expect(getAnswer({ format: null }, 'format')).toBeNull()
  })

  it('treats null, undefined, blank strings, and empty lists as empty', () => {
    expect(isValueEmpty(null)).toBe(true)
    expect(isValueEmpty(undefined)).toBe(true)
    expect(isValueEmpty('')).toBe(true)
    expect(isValueEmpty('   ')).toBe(true)
    expect(isValueEmpty([])).toBe(true)
    expect(isValueEmpty('x')).toBe(false)
    expect(isValueEmpty(['ai'])).toBe(false)
    expect(isValueEmpty(0)).toBe(false)
    expect(isValueEmpty(false)).toBe(false)
  })
})

describe('validateAnswersAgainstVersion', () => {
  const validAnswers = {
    title: 'Hands-on workshop',
    format: 'workshop',
    'contact-email': 'speaker-a@example.test',
    workshop: 'Bring a laptop',
    attendees: 25,
    topics: ['ai'],
  }

  it('accepts answers for all visible required fields', () => {
    expect(validateAnswersAgainstVersion(content, validAnswers)).toEqual([])
  })

  it('rejects unknown fields', () => {
    const issues = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      hacked: 'value',
    })

    expect(issues.some((issue) => issue.code === 'unknown_field')).toBe(true)
  })

  it('rejects hidden-field tampering while tolerating hidden empty fields', () => {
    const hiddenValue = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      format: 'talk',
      workshop: 'sneaky',
    })
    const hiddenEmpty = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      format: 'talk',
      workshop: '',
    })

    expect(hiddenValue.some((issue) => issue.code === 'hidden_field_submitted')).toBe(true)
    expect(hiddenEmpty.some((issue) => issue.code === 'hidden_field_submitted')).toBe(false)
  })

  it('rejects missing required answers, including rule-required fields', () => {
    const missingTitle = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      title: '   ',
    })
    const requireRule = {
      ...showWorkshopRule,
      id: 'rule-require-topics',
      elementId: topicsElement.id,
      effect: 'require' as const,
    }
    const ruleRequired = validateAnswersAgainstVersion(
      createContent({ conditionRules: [requireRule] }),
      { ...validAnswers, topics: [] },
    )

    expect(missingTitle.some((issue) => issue.code === 'missing_required')).toBe(true)
    expect(ruleRequired.some((issue) => issue.code === 'missing_required')).toBe(true)
  })

  it('rejects type-invalid answers per question type', () => {
    const badEmail = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      'contact-email': 'not-an-email',
    })
    const badNumber = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      attendees: '25',
    })
    const badSingleChoice = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      format: 42,
    })
    const badMultiChoice = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      topics: 'ai',
    })

    expect(badEmail.some((issue) => issue.code === 'invalid_type')).toBe(true)
    expect(badNumber.some((issue) => issue.code === 'invalid_type')).toBe(true)
    expect(badSingleChoice.some((issue) => issue.code === 'invalid_type')).toBe(true)
    expect(badMultiChoice.some((issue) => issue.code === 'invalid_type')).toBe(true)
  })

  it('rejects values exceeding the configured max length', () => {
    const issues = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      workshop: 'x'.repeat(501),
    })

    expect(issues.some((issue) => issue.code === 'exceeds_max_length')).toBe(true)
  })

  it('rejects unknown options for single and multi choice', () => {
    const single = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      format: 'keynote',
    })
    const multi = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      topics: ['ai', 'security'],
    })
    const nonStringOption = validateAnswersAgainstVersion(content, {
      ...validAnswers,
      topics: ['ai', 42] as unknown as readonly string[],
    })

    expect(single.some((issue) => issue.code === 'invalid_option')).toBe(true)
    expect(multi.some((issue) => issue.code === 'invalid_option')).toBe(true)
    expect(nonStringOption.some((issue) => issue.code === 'invalid_option')).toBe(true)
  })

  it('skips type checks for non-question elements', () => {
    const heading = createElement({
      id: 'element-heading',
      position: 6,
      kind: 'heading',
      fieldKey: 'heading-key',
      label: 'Heading',
      required: false,
      questionType: null,
    })
    const headingContent = createContent({
      elements: [
        heading,
        titleElement,
        formatElement,
        emailElement,
        attendeesElement,
        topicsElement,
        workshopElement,
      ],
    })

    expect(validateAnswersAgainstVersion(headingContent, validAnswers)).toEqual([])
  })
})
