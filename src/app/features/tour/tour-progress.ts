export const TOUR_PROGRESS_EVENT = 'open-events:tour-progress'

const TOUR_PROGRESS_KEY = 'open-events:tour-progress'
const TOUR_PROGRESS_VERSION = 1

export type TourProgressStatus = 'active' | 'paused'

export interface TourProgress {
  readonly stepId: string
  readonly status: TourProgressStatus
}

function announceProgressChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TOUR_PROGRESS_EVENT))
}

/** Reads a versioned checkpoint and ignores stale or malformed browser data. */
export function readTourProgress(): TourProgress | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TOUR_PROGRESS_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      parsed.version !== TOUR_PROGRESS_VERSION ||
      typeof parsed.stepId !== 'string' ||
      (parsed.status !== 'active' && parsed.status !== 'paused')
    ) {
      return null
    }
    return { stepId: parsed.stepId, status: parsed.status }
  } catch {
    return null
  }
}

export function writeTourProgress(stepId: string, status: TourProgressStatus): void {
  try {
    window.localStorage.setItem(
      TOUR_PROGRESS_KEY,
      JSON.stringify({ version: TOUR_PROGRESS_VERSION, stepId, status }),
    )
  } catch {
    // The current tour still works when browser storage is unavailable.
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
