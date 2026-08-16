import { describe, expect, it } from 'vitest'

import type { SpeakerTask } from '../../../src/domain'
import {
  SPEAKER_TASK_KINDS,
  completeSpeakerTask,
  computeReadinessTotals,
  isSubmissionReady,
} from '../../../src/domain'

const CREATED_AT = '2026-05-20T09:00:00.000Z'
const COMPLETED_AT = '2026-05-21T09:00:00.000Z'

function task(overrides: Partial<SpeakerTask> = {}): SpeakerTask {
  return {
    id: 'task-1',
    eventId: 'event-demo-conf',
    submissionId: 'submission-1',
    contactId: 'contact-speaker-a',
    kind: 'confirm_participation',
    status: 'pending',
    position: 0,
    createdAt: CREATED_AT,
    completedAt: null,
    formId: null,
    formVersionId: null,
    response: null,
    ...overrides,
  }
}

describe('speaker task checklist', () => {
  it('pins the ordered onboarding checklist', () => {
    expect(SPEAKER_TASK_KINDS).toEqual(['confirm_participation', 'submit_bio', 'submit_headshot'])
  })

  it('computes readiness totals as an integer percentage', () => {
    const tasks = [
      task({ id: 'task-1', status: 'completed', completedAt: COMPLETED_AT }),
      task({ id: 'task-2' }),
      task({ id: 'task-3' }),
    ]
    expect(computeReadinessTotals(tasks)).toEqual({
      totalTasks: 3,
      completedTasks: 1,
      percentComplete: 33,
    })
  })

  it('treats an empty checklist as vacuously complete', () => {
    expect(computeReadinessTotals([])).toEqual({
      totalTasks: 0,
      completedTasks: 0,
      percentComplete: 100,
    })
    expect(isSubmissionReady([])).toBe(true)
  })

  it('reports readiness only when every task is completed', () => {
    const completed = task({ status: 'completed', completedAt: COMPLETED_AT })
    expect(isSubmissionReady([completed])).toBe(true)
    expect(isSubmissionReady([completed, task({ id: 'task-2' })])).toBe(false)
  })

  it('completes a pending task once and is a no-op afterwards', () => {
    const pending = task()
    const completed = completeSpeakerTask(pending, COMPLETED_AT)
    expect(completed).toEqual({ ...pending, status: 'completed', completedAt: COMPLETED_AT })
    expect(completeSpeakerTask(completed, '2026-05-22T09:00:00.000Z')).toBe(completed)
  })
})
