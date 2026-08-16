/**
 * Outcome announcements for user-initiated mutations.
 *
 * A module-level external store rather than React context, so a plain helper
 * (a query callback, a recovery routine) can announce without being a hook.
 * The component that renders the regions is always mounted, which is the
 * property that makes announcements reliable: a live region has to be in the
 * accessibility tree BEFORE its text changes, and every inline region in this
 * app is mounted together with its message.
 *
 * ONE LIVE REGION PER OUTCOME. The inline
 * StatusLive/AlertLive nodes are themselves live regions, not silent visual
 * chips, so calling announce() with a message a surface already renders inline
 * makes a screen reader say it twice. announce() is therefore for outcomes the
 * surface cannot voice itself: the message has no inline node, or the subtree
 * that would hold it is replaced or navigated away from.
 *
 * Never call this from a query lifecycle. Background refetches and route
 * preloads must stay silent; announce() belongs in mutation callbacks and
 * explicit user actions only.
 */

export type Politeness = 'polite' | 'assertive'

export interface Announcement {
  readonly message: string
  readonly politeness: Politeness
  /** Increments on every announce so an identical repeat is a real change. */
  readonly seq: number
}

const EMPTY: Announcement = { message: '', politeness: 'polite', seq: 0 }

let snapshot: Announcement = EMPTY
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function announce(message: string, politeness: Politeness = 'polite'): void {
  if (message === '') return
  snapshot = { message, politeness, seq: snapshot.seq + 1 }
  emit()
}

/** Legitimate API: called on teardown and between tests, never to hide a result. */
export function clearAnnouncements(): void {
  if (snapshot === EMPTY) return
  snapshot = EMPTY
  emit()
}

export function subscribeToAnnouncements(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Stable reference between announces, as useSyncExternalStore requires. */
export function getAnnouncementSnapshot(): Announcement {
  return snapshot
}
