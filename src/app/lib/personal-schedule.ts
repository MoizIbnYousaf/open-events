const PERSONAL_PREFIX = 'oe-personal-schedule:'

function store(): Storage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function readPersonalSchedule(eventSlug: string): readonly string[] {
  const memory = store()
  if (memory === null) return []
  try {
    const raw = memory.getItem(PERSONAL_PREFIX + eventSlug)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function writePersonalSchedule(eventSlug: string, ids: readonly string[]): void {
  const memory = store()
  if (memory === null) return
  try {
    memory.setItem(PERSONAL_PREFIX + eventSlug, JSON.stringify(ids))
  } catch {
    // storage disabled
  }
}
