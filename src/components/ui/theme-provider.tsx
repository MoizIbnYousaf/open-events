import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

import {
  applyScheme,
  nextPreference,
  prefersDark,
  readStoredPreference,
  resolveScheme,
  safeLocalStorage,
  writeStoredPreference,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  type ResolvedScheme,
  type ThemePreference,
} from '../../lib/theme'
import { isEditableTarget } from '../../app/lib/editable-target'

interface ThemeContextValue {
  readonly preference: ThemePreference
  readonly scheme: ResolvedScheme
  readonly setTheme: (next: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Owns the runtime half of theming: the stored preference, the live system
 * preference, the class/colour-scheme applied to <html>, and the documented
 * Ctrl/Cmd+Shift+D shortcut with L retained as an alias (DEC-015).
 *
 * Mounted by the application shell in src/main.tsx, above the router: the
 * stored scheme and the global chord belong to the app rather than to whichever
 * route is matched, so neither is lost when the router remounts or crashes.
 * Harnesses that render a route subtree mount this provider themselves, the
 * same way the shell does.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredPreference(safeLocalStorage()),
  )
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    prefersDark(typeof window === 'undefined' ? null : window),
  )
  const [announcement, setAnnouncement] = useState('')
  const hasInteractedRef = useRef(false)
  const scheme = resolveScheme(preference, systemDark)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    applyScheme(document.documentElement, preference, scheme)
  }, [preference, scheme])

  useEffect(() => {
    // Never speak on first mount, or every page load announces the theme.
    if (!hasInteractedRef.current) return
    setAnnouncement(
      preference === 'system' ? `Theme: System (${scheme})` : `Theme: ${THEME_LABELS[preference]}`,
    )
  }, [preference, scheme])

  const setTheme = useCallback((next: ThemePreference) => {
    hasInteractedRef.current = true
    setPreferenceState(next)
    writeStoredPreference(next, safeLocalStorage())
  }, [])

  // Adopt a preference another tab wrote, without echoing it back to storage.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return
      const stored = readStoredPreference(safeLocalStorage())
      hasInteractedRef.current = true
      setPreferenceState(stored)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // A modifier chord only, inert while composing, on key-repeat, or once
      // something else has already consumed the event. preventDefault is called
      // only on the path that actually acts.
      if (event.defaultPrevented || event.repeat || event.isComposing) return
      if (event.altKey || !event.shiftKey) return
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key !== 'd' && key !== 'l') return
      // Keep this guard local to the document listener as well as sharing the
      // helper with the focused theme control. That makes the safety boundary
      // auditable at the exact place where a global shortcut can consume input.
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select') ||
          target.isContentEditable ||
          isEditableTarget(target))
      ) {
        return
      }
      event.preventDefault()
      setTheme(nextPreference(preference))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [preference, setTheme])

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, scheme, setTheme }),
    [preference, scheme, setTheme],
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
      {/*
        Deliberately aria-live without role="status": a change to an unfocused
        control is announced by nothing otherwise, but a second page-global
        status node would make every surface's own status region ambiguous.
      */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </ThemeContext.Provider>
  )
}

/**
 * First-letter selection for the visible theme control: with focus inside the
 * control, S, L and D choose System, Light and Dark. The letters are the option
 * names themselves, not a chord to memorise, which is how a native <select> and
 * every ARIA menu already behave.
 *
 * Scoped to the control, never to the document (DEC-020). The app claims
 * the global D/L chords (DEC-015) use modifiers, while a bare letter listening
 * on the document would fire while someone was only reading the page.
 * Nothing here reaches the document, and a letter held with any modifier is
 * left alone, because those combinations belong to the browser.
 *
 * The typing guard is the shared one rather than a copy, which is the reason
 * isEditableTarget is exported at all: this handler sits on a container, so
 * anything editable inside it keeps its own keystrokes.
 */
export function useThemePreferenceKeys(): (event: ReactKeyboardEvent<HTMLElement>) => void {
  const { setTheme } = useTheme()

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      // Composition state lives on the native event: a letter being composed
      // by an IME is not a shortcut.
      if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing) return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const preference: ThemePreference | null =
        key === 's' ? 'system' : key === 'l' ? 'light' : key === 'd' ? 'dark' : null
      if (preference === null) return
      event.preventDefault()
      setTheme(preference)
    },
    [setTheme],
  )

  return onKeyDown
}

/**
 * The theme when there is one, and null when there is not.
 *
 * For the handful of chrome components that are legitimately rendered outside
 * the provider — the toaster, which unit tests mount beside a single surface —
 * so that "no provider" degrades to the system scheme instead of throwing.
 * Everything that belongs to a screen uses `useTheme()` and must throw.
 */
export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext)
}

export function useTheme(): ThemeContextValue {
  const value = useOptionalTheme()
  if (value === null) {
    throw new Error('useTheme must be used inside a ThemeProvider')
  }
  return value
}
