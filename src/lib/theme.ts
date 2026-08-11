/**
 * Pure theme selection. Kept free of React and of DOM assumptions so the
 * provider holds no untestable logic and the storage key is shared with the
 * pre-paint boot script in index.html.
 *
 * The token layer for both schemes already existed; what was missing was any
 * runtime that picks one. `:root { color-scheme: light dark }` additionally
 * told the browser to paint native widgets dark on a dark-preferring OS while
 * the token set stayed light, so datetime, select, checkbox and file controls
 * disagreed with the surface behind them.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedScheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'speakerops.theme'
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** Never throws: blocked storage (Safari private mode) falls back to 'system'. */
export function readStoredPreference(storage: Storage | null): ThemePreference {
  if (storage === null) return 'system'
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

/** Never throws. */
export function writeStoredPreference(pref: ThemePreference, storage: Storage | null): void {
  if (storage === null) return
  try {
    storage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // Storage can be unavailable; the in-memory preference still applies.
  }
}

/**
 * Feature-detects matchMedia. jsdom does not implement it, and 15 unit test
 * files mount the real route tree — an unguarded call would crash all of them.
 */
export function prefersDark(win: Window | null): boolean {
  if (win === null) return false
  if (typeof win.matchMedia !== 'function') return false
  try {
    return win.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function resolveScheme(pref: ThemePreference, systemDark: boolean): ResolvedScheme {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  return systemDark ? 'dark' : 'light'
}

export function nextPreference(pref: ThemePreference): ThemePreference {
  switch (pref) {
    case 'system':
      return 'light'
    case 'light':
      return 'dark'
    case 'dark':
      return 'system'
  }
}

export function applyScheme(
  root: HTMLElement,
  pref: ThemePreference,
  scheme: ResolvedScheme,
): void {
  root.classList.toggle('dark', scheme === 'dark')
  root.style.colorScheme = scheme
  root.dataset.theme = pref
}

/** Null when storage is unavailable, so callers never touch a throwing getter. */
export function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}
