/** Fired on `window` to toggle the tour from the visible header control. */
export const TOUR_TOGGLE_EVENT = 'open-events:tour-toggle'

// The overlay is lazy-loaded. A fast first click can happen before its effect
// has installed the event listener, so the entry chunk keeps one pending
// request for the lazy chunk to consume after it mounts.
let pendingToggle = false

export function requestTourToggle(): void {
  pendingToggle = true
  window.dispatchEvent(new CustomEvent(TOUR_TOGGLE_EVENT))
}

export function consumePendingTourToggle(): boolean {
  const pending = pendingToggle
  pendingToggle = false
  return pending
}
