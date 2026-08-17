import { describe, expect, it } from 'vitest'

import type { SubmissionListItemDto } from '../../../src/application'
import {
  DEFAULT_SUBMISSION_OPERATIONS,
  operateOnSubmissions,
  readSubmissionOperations,
  submissionsCsv,
  writeSubmissionOperations,
} from '../../../src/app/features/admin/submission-operations'

function row(
  id: string,
  title: string,
  decision: SubmissionListItemDto['decision'],
  submittedAt: string,
  route: string | null,
): SubmissionListItemDto {
  return {
    id,
    title,
    status: 'pending',
    source: 'cfp',
    formId: 'form',
    formSlug: 'cfp',
    version: 1,
    routing: route === null ? null : { actionKind: 'assign_track', actionTarget: route },
    primarySpeaker: {
      contactId: `contact-${id}`,
      name: `Speaker ${id}`,
      email: `${id}@example.test`,
      role: 'primary',
      position: 0,
    },
    coSpeakerCount: 0,
    decision,
    createdAt: submittedAt,
    submittedAt,
  }
}

const ROWS = [
  row('a', '=Formula talk', 'accepted', '2026-01-01T10:00:00.000Z', 'platform'),
  row('b', 'Unicode café', 'pending', '2026-01-02T10:00:00.000Z', 'ai'),
  row('c', 'Rejected talk', 'rejected', '2026-01-03T10:00:00.000Z', null),
]

describe('submission desk operations', () => {
  it('combines filters and applies a stable explicit sort', () => {
    expect(
      operateOnSubmissions(ROWS, '', {
        decision: 'accepted',
        routing: 'platform',
        sort: 'title-asc',
      }).map((item) => item.id),
    ).toEqual(['a'])
    expect(
      operateOnSubmissions(ROWS, 'talk', {
        ...DEFAULT_SUBMISSION_OPERATIONS,
        sort: 'submitted-asc',
      }).map((item) => item.id),
    ).toEqual(['a', 'c'])
  })

  it('round-trips valid URL state and drops invalid values', () => {
    const encoded = writeSubmissionOperations('?keep=one', {
      decision: 'rejected',
      routing: 'ai',
      sort: 'title-asc',
    })
    expect(encoded).toBe('?keep=one&decision=rejected&routing=ai&sort=title-asc')
    expect(readSubmissionOperations(encoded)).toEqual({
      decision: 'rejected',
      routing: 'ai',
      sort: 'title-asc',
    })
    expect(readSubmissionOperations('?decision=nope&sort=nope')).toEqual(
      DEFAULT_SUBMISSION_OPERATIONS,
    )
  })

  it('exports only supplied rows as UTF-8 CSV and neutralizes formulas', () => {
    const csv = submissionsCsv([ROWS[0]!, ROWS[1]!])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"\'=Formula talk"')
    expect(csv).toContain('"Unicode café"')
    expect(csv).not.toContain('Rejected talk')
    expect(csv.split('\r\n')).toHaveLength(4)
  })
})
