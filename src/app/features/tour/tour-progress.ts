import { TOUR_STEPS, tourChapterForStep, type TourChapterId } from './tour-steps'

export const TOUR_PROGRESS_EVENT = 'open-events:tour-progress'
export const TOUR_PROGRESS_VERSION = 2
export const TOUR_PROGRESS_TTL_MS = 7 * 24 * 60 * 60 * 1000

const TOUR_PROGRESS_KEY = 'open-events:tour-progress'

export type TourProgressStatus = 'active' | 'paused'

export interface TourProgress {
  readonly definitionVersion: number
  readonly chapter: TourChapterId
  readonly stepId: string
  readonly visitedStepIds: readonly string[]
  readonly status: TourProgressStatus
  readonly updatedAt: number
}

function announceProgressChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TOUR_PROGRESS_EVENT))
}

function validStepId(value: unknown): value is string {
  return typeof value === 'string' && TOUR_STEPS.some((step) => step.id === value)
}

function normalizeVisited(value: unknown, stepId: string): readonly string[] {
  const values = Array.isArray(value) ? value.filter(validStepId) : []
  return [...new Set([...values, stepId])]
}

function migrateV1(parsed: Record<string, unknown>, now: number): TourProgress | null {
  if (parsed.version !== 1 || !validStepId(parsed.stepId)) return null
  if (parsed.status !== 'active' && parsed.status !== 'paused') return null
  const chapter = tourChapterForStep(parsed.stepId)
  if (chapter === null) return null
  return {
    definitionVersion: TOUR_PROGRESS_VERSION,
    chapter,
    stepId: parsed.stepId,
    visitedStepIds: [parsed.stepId],
    status: parsed.status,
    updatedAt: now,
  }
}

/** Reads a checkpoint, migrating v1 and clearing incompatible or expired state. */
export function readTourProgress(now = Date.now()): TourProgress | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TOUR_PROGRESS_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const migrated = migrateV1(parsed, now)
    if (migrated !== null) {
      writeTourProgress(
        migrated.stepId,
        migrated.status,
        migrated.visitedStepIds,
        migrated.updatedAt,
      )
      return migrated
    }
    if (
      parsed.version !== TOUR_PROGRESS_VERSION ||
      !validStepId(parsed.stepId) ||
      (parsed.status !== 'active' && parsed.status !== 'paused') ||
      typeof parsed.updatedAt !== 'number' ||
      !Number.isFinite(parsed.updatedAt) ||
      now - parsed.updatedAt > TOUR_PROGRESS_TTL_MS
    ) {
      clearTourProgress()
      return null
    }
    const chapter = tourChapterForStep(parsed.stepId)
    if (chapter === null || parsed.chapter !== chapter) {
      clearTourProgress()
      return null
    }
    return {
      definitionVersion: TOUR_PROGRESS_VERSION,
      chapter,
      stepId: parsed.stepId,
      visitedStepIds: normalizeVisited(parsed.visitedStepIds, parsed.stepId),
      status: parsed.status,
      updatedAt: parsed.updatedAt,
    }
  } catch {
    clearTourProgress()
    return null
  }
}

export function writeTourProgress(
  stepId: string,
  status: TourProgressStatus,
  visitedStepIds: readonly string[] = [stepId],
  updatedAt = Date.now(),
): void {
  const chapter = tourChapterForStep(stepId)
  if (chapter === null) return
  try {
    window.localStorage.setItem(
      TOUR_PROGRESS_KEY,
      JSON.stringify({
        version: TOUR_PROGRESS_VERSION,
        chapter,
        stepId,
        visitedStepIds: normalizeVisited(visitedStepIds, stepId),
        status,
        updatedAt,
      }),
    )
  } catch {
    // The current run remains usable without persistent browser storage.
  }
  announceProgressChange()
}

export function clearTourProgress(): void {
  try {
    window.localStorage.removeItem(TOUR_PROGRESS_KEY)
  } catch {
    // There may be nothing writable to clear.
  }
  announceProgressChange()
}

export function hasPausedTourProgress(): boolean {
  return readTourProgress()?.status === 'paused'
}
