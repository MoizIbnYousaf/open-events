/**
 * Stand-ins for the browser APIs jsdom does not implement.
 *
 * `window.matchMedia`:
 * The app tolerates the gap (the theme provider feature-detects it), but the
 * toaster in the root shell reaches for it unconditionally, so without this
 * every test that mounts the app would fail on an API that is never missing in
 * production. The stand-in reports "no preference" and supports both the
 * modern and the legacy listener pairs; a test that cares about a specific
 * media query still stubs its own.
 */
function createMediaQueryList(query: string): MediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const list: MediaQueryList = {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.add(listener as never)
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.delete(listener as never)
    },
    addListener: (listener) => {
      if (listener !== null) listeners.add(listener as never)
    },
    removeListener: (listener) => {
      if (listener !== null) listeners.delete(listener as never)
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners) listener(event as MediaQueryListEvent)
      return true
    },
  }
  return list
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => createMediaQueryList(query),
  })
}

/**
 * Pointer capture: jsdom fires pointer events but implements none of the
 * capture API, so a component that claims the pointer for a drag — the
 * toaster's swipe-to-dismiss — throws inside an event handler the moment a
 * test clicks a card. Capture has no meaning without a real pointer, so the
 * stand-ins record nothing and simply do not throw.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {}
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
}

/**
 * jsdom keeps one `sessionStorage` for the whole file, but every `render` in a
 * suite is a fresh visit to the product. Anything a component parks there — a
 * CFP draft waiting out the identity detour, an evaluator's unsaved rating —
 * would otherwise be restored into the next test and move it to a step it
 * never asked for. A real browser gives each tab its own storage; this gives
 * each test the same courtesy.
 */
import { afterEach } from 'vitest'

afterEach(() => {
  try {
    window.sessionStorage.clear()
  } catch {
    // A test that deliberately disables storage has nothing to clear.
  }
})
