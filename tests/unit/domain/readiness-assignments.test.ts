import { describe, expect, it } from 'vitest'

import {
  extraReadinessFromAssignments,
  readinessFromTasksAndAssignments,
} from '../../../src/domain/readiness-assignments'
import type { SpeakerTask } from '../../../src/domain/speaker-task'

describe('readiness with speaker assignments', () => {
  it('counts a pending file request against the session contributors', () => {
    const extra = extraReadinessFromAssignments(new Set(['c-1']), [
      { contactId: 'c-1', status: 'pending' },
      { contactId: 'c-9', status: 'pending' },
    ])
    expect(extra).toEqual({ total: 1, completed: 0 })
  })

  it('keeps a session from reading Ready while a file request is open', () => {
    const done: SpeakerTask[] = [
      {
        id: 't1',
        eventId: 'e',
        submissionId: 's',
        contactId: 'c-1',
        kind: 'confirm_participation',
        status: 'completed',
        position: 0,
        createdAt: '2026-05-20T09:00:00.000Z',
        completedAt: '2026-05-20T10:00:00.000Z',
        formId: null,
        formVersionId: null,
        response: null,
      },
    ]
    const totals = readinessFromTasksAndAssignments(done, { total: 1, completed: 0 })
    expect(totals.totalTasks).toBe(2)
    expect(totals.completedTasks).toBe(1)
    expect(totals.percentComplete).toBe(50)
  })
})
