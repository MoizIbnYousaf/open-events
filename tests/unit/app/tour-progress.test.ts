import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TOUR_PROGRESS_TTL_MS,
  TOUR_PROGRESS_VERSION,
  clearTourProgress,
  readTourProgress,
  writeTourProgress,
} from '../../../src/app/features/tour/tour-progress'

describe('tour progress v2', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.setSystemTime(new Date('2026-08-16T22:00:00.000Z'))
  })

  it('persists exact chapter, moment, visited set, status, and timestamp', () => {
    writeTourProgress('speaker-files', 'paused', ['welcome', 'speaker-portal', 'speaker-files'])
    expect(readTourProgress()).toEqual({
      definitionVersion: TOUR_PROGRESS_VERSION,
      chapter: 'speaker',
      stepId: 'speaker-files',
      visitedStepIds: ['welcome', 'speaker-portal', 'speaker-files'],
      status: 'paused',
      updatedAt: Date.now(),
    })
  })

  it('expires stale progress and clears malformed or unknown moments', () => {
    writeTourProgress('welcome', 'paused', ['welcome'])
    vi.setSystemTime(Date.now() + TOUR_PROGRESS_TTL_MS + 1)
    expect(readTourProgress()).toBeNull()

    window.localStorage.setItem(
      'open-events:tour-progress',
      JSON.stringify({ version: TOUR_PROGRESS_VERSION, stepId: 'missing' }),
    )
    expect(readTourProgress()).toBeNull()
    clearTourProgress()
  })

  it('migrates a valid v1 checkpoint without marking skipped moments complete', () => {
    window.localStorage.setItem(
      'open-events:tour-progress',
      JSON.stringify({ version: 1, stepId: 'event-settings', status: 'paused' }),
    )
    expect(readTourProgress()).toMatchObject({
      definitionVersion: TOUR_PROGRESS_VERSION,
      chapter: 'organizer',
      stepId: 'event-settings',
      visitedStepIds: ['event-settings'],
      status: 'paused',
    })
  })
})
