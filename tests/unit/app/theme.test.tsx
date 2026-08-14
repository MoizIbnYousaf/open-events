import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider, useThemePreferenceKeys } from '../../../src/components/ui/theme-provider'
import { ThemeToggle } from '../../../src/components/ui/theme-toggle'
import {
  THEME_STORAGE_KEY,
  nextPreference,
  prefersDark,
  readStoredPreference,
  resolveScheme,
} from '../../../src/lib/theme'

const ROOT = resolve(import.meta.dirname, '../../..')

function readSource(relative: string): string {
  return readFileSync(resolve(ROOT, relative), 'utf8')
}

function mountToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

/** A controllable stand-in for a MediaQueryList. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const removeEventListener = vi.fn((_: string, listener: (e: MediaQueryListEvent) => void) => {
    listeners.delete(listener)
  })
  const list = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener,
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => list),
  )
  return {
    removeEventListener,
    emit(next: boolean) {
      act(() => {
        list.matches = next
        for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent)
      })
    },
  }
}

/**
 * jsdom in this project ships no localStorage at all, which is exactly the
 * blocked-storage case the module has to survive. Tests that need persistence
 * install an in-memory Storage; the rest run without one on purpose.
 */
function installStorage(): Storage {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
  return storage
}

beforeEach(() => {
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'localStorage')
  cleanup()
})

describe('theme module', () => {
  it('falls back to system for a missing, unknown, or throwing store', () => {
    expect(readStoredPreference(null)).toBe('system')
    const storage = installStorage()
    storage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(readStoredPreference(storage)).toBe('system')
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(readStoredPreference(throwing)).toBe('system')
  })

  it('feature-detects matchMedia instead of assuming it exists', () => {
    // Not every host has it: jsdom ships without it, and these tests only see
    // one because the setup file stands one in for the toaster. An unguarded
    // call would crash every surface that reads the system preference, so the
    // guard is asserted against a window that lacks it rather than against
    // whichever environment happens to be running.
    expect(prefersDark({} as unknown as Window)).toBe(false)
    expect(prefersDark({ matchMedia: null } as unknown as Window)).toBe(false)
    expect(prefersDark(null)).toBe(false)
    expect(prefersDark(window)).toBe(false)
  })

  it('lets an explicit preference beat the system preference', () => {
    expect(resolveScheme('light', true)).toBe('light')
    expect(resolveScheme('dark', false)).toBe('dark')
    expect(resolveScheme('system', true)).toBe('dark')
    expect(resolveScheme('system', false)).toBe('light')
  })

  it('cycles system → light → dark → system', () => {
    expect(nextPreference('system')).toBe('light')
    expect(nextPreference('light')).toBe('dark')
    expect(nextPreference('dark')).toBe('system')
  })
})

describe('theme provider', () => {
  it('renders without matchMedia and applies the light default', () => {
    mountToggle()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('follows a dark system preference', () => {
    stubMatchMedia(true)
    mountToggle()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('keeps an explicit light choice when the system reports dark', () => {
    stubMatchMedia(true)
    installStorage().setItem(THEME_STORAGE_KEY, 'light')
    mountToggle()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('follows system changes only while the preference is system', async () => {
    const media = stubMatchMedia(false)
    const user = userEvent.setup()
    mountToggle()

    media.emit(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Light' }))
    media.emit(false)
    media.emit(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('stops listening to the media query on unmount', () => {
    const media = stubMatchMedia(false)
    const view = mountToggle()

    view.unmount()
    expect(media.removeEventListener).toHaveBeenCalled()
  })
})

describe('theme toggle', () => {
  it('offers exactly three named options in a labelled group', () => {
    mountToggle()

    const group = screen.getByRole('group', { name: 'Theme' })
    expect(group).toBeInTheDocument()
    for (const name of ['System', 'Light', 'Dark']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('persists an explicit choice and applies it', async () => {
    const user = userEvent.setup()
    const storage = installStorage()
    mountToggle()

    await user.click(screen.getByRole('button', { name: 'Dark' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('still applies a choice when storage is unavailable', async () => {
    const user = userEvent.setup()
    mountToggle()

    await user.click(screen.getByRole('button', { name: 'Dark' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('announces the change without adding a second status region', async () => {
    const user = userEvent.setup()
    const { container } = mountToggle()

    await user.click(screen.getByRole('button', { name: 'Dark' }))

    const region = container.querySelector('[aria-live="polite"]')
    expect(region).toHaveTextContent('Theme: Dark')
    expect(screen.queryAllByRole('status')).toHaveLength(0)
  })

  it('names the same chord to assistive tech and to sighted users', () => {
    const { container } = mountToggle()

    // Both channels must name the one chord the provider actually handles;
    // advertising a chord the app ignores is a control that does nothing.
    const host = container.querySelector('[aria-keyshortcuts]')
    expect(host?.getAttribute('aria-keyshortcuts')).toBe(
      'Control+Shift+D Meta+Shift+D Control+Shift+L Meta+Shift+L',
    )
    expect(container.querySelector('kbd')?.textContent).toMatch(/D$/)
  })
})

describe('theme shortcut', () => {
  async function press(
    user: ReturnType<typeof userEvent.setup>,
    keys: string,
    target?: HTMLElement,
  ) {
    if (target !== undefined) {
      target.focus()
    }
    await user.keyboard(keys)
  }

  it('cycles the preference on Control+Shift+L', async () => {
    const user = userEvent.setup()
    mountToggle()

    await press(user, '{Control>}{Shift>}l{/Shift}{/Control}')
    expect(document.documentElement.dataset.theme).toBe('light')
    await press(user, '{Control>}{Shift>}l{/Shift}{/Control}')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await press(user, '{Control>}{Shift>}l{/Shift}{/Control}')
    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('cycles on Control/Meta+Shift+D and keeps L as an alias', async () => {
    const user = userEvent.setup()
    mountToggle()

    await press(user, '{Control>}{Shift>}d{/Shift}{/Control}')
    expect(document.documentElement.dataset.theme).toBe('light')
    await press(user, '{Meta>}{Shift>}d{/Shift}{/Meta}')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await press(user, '{Control>}{Shift>}l{/Shift}{/Control}')
    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('consumes the D chord only on the path that acts', () => {
    render(<ThemeProvider>{null}</ThemeProvider>)

    const event = new KeyboardEvent('keydown', {
      key: 'D',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('cycles on Meta+Shift+L too', async () => {
    const user = userEvent.setup()
    mountToggle()

    await press(user, '{Meta>}{Shift>}l{/Shift}{/Meta}')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('stays inert while focus is in an editable control', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <input aria-label="Proposal title" />
        <textarea aria-label="Abstract" />
        <select aria-label="Track">
          <option>General</option>
        </select>
        <div contentEditable aria-label="Notes" role="textbox" tabIndex={0} />
      </ThemeProvider>,
    )

    for (const name of ['Proposal title', 'Abstract', 'Track', 'Notes']) {
      for (const chord of [
        '{Control>}{Shift>}d{/Shift}{/Control}',
        '{Control>}{Shift>}l{/Shift}{/Control}',
      ]) {
        await press(user, chord, screen.getByLabelText(name))
        expect(document.documentElement.dataset.theme).toBe('system')
      }
    }
  })

  it('never fires on a bare key, on key repeat, or with Alt held', async () => {
    const user = userEvent.setup()
    mountToggle()

    await user.keyboard('l')
    expect(document.documentElement.dataset.theme).toBe('system')

    await user.keyboard('{Alt>}{Control>}{Shift>}l{/Shift}{/Control}{/Alt}')
    expect(document.documentElement.dataset.theme).toBe('system')

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'l',
        ctrlKey: true,
        shiftKey: true,
        repeat: true,
        bubbles: true,
      }),
    )
    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('ignores an event another handler already consumed', () => {
    mountToggle()

    const event = new KeyboardEvent('keydown', {
      key: 'l',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    event.preventDefault()
    document.dispatchEvent(event)

    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('removes its listener on unmount', () => {
    const view = mountToggle()
    view.unmount()

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, shiftKey: true, bubbles: true }),
    )
    expect(document.documentElement.dataset.theme).toBe('system')
  })
})

describe('pre-paint theme boot', () => {
  it('runs the boot script before the app module and guards blocked storage', () => {
    const html = readSource('index.html')
    const bootIndex = html.indexOf('localStorage.getItem')
    const moduleIndex = html.indexOf('<script type="module" src="/src/main.tsx">')
    expect(bootIndex).toBeGreaterThan(-1)
    expect(moduleIndex).toBeGreaterThan(bootIndex)
    expect(html).toContain('try {')
    expect(html).toContain('} catch (e) {')
  })

  it('uses the same storage key as the runtime module', () => {
    expect(readSource('index.html')).toContain(THEME_STORAGE_KEY)
  })

  it('derives color-scheme from the same class that drives the tokens', () => {
    const css = readSource('src/index.css')
    expect(css).not.toContain('color-scheme: light dark')
    expect(css).toMatch(/\.dark \{\n\s*color-scheme: dark;/)
  })

  it('uses the Perfect Paper dark ladder on the canvas and cards', () => {
    const css = readSource('src/index.css')
    expect(css).toMatch(/\.dark \{[\s\S]*--background: #080808;/)
    expect(css).toMatch(/\.dark \{[\s\S]*--card: #121212;/)
    expect(css).toContain('--background: #fcfcfc;')
    expect(css).toContain('--primary: #0075de;')
  })

  // R1-M1: from lg up the page toolbar is sticky at the top of #main, which is
  // the scrolling box — so a control focused below the fold was scrolled to the
  // box's edge and landed UNDER the toolbar. The stylesheet is where this is
  // fixed, at zero cost to any chunk, and it is only true above the breakpoint
  // where the row is actually sticky.
  it('keeps focus from scrolling under the sticky page toolbar', () => {
    const css = readSource('src/index.css')
    expect(css).toMatch(
      /@media \(min-width: 1024px\) \{\n\s*#main \{\n\s*scroll-padding-top: var\(--navbar-height\);/,
    )
    // The offset is the PAGE header's height, and that token is what the row
    // itself is drawn at — one definition, or the two drift apart.
    expect(css).toMatch(/--navbar-height: 3\.5rem;/)
  })
})

describe('theme control keys', () => {
  /** A container that adopts the control's key handling, plus a text field. */
  function KeyedContainer() {
    const onKeyDown = useThemePreferenceKeys()
    return (
      <div onKeyDown={onKeyDown}>
        <button type="button">focusable</button>
        <input aria-label="note" />
      </div>
    )
  }

  it('selects the option whose name starts with the pressed letter', async () => {
    const user = userEvent.setup()
    mountToggle()

    screen.getByRole('button', { name: 'System' }).focus()
    await user.keyboard('d')
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.keyboard('l')
    expect(document.documentElement.dataset.theme).toBe('light')
    await user.keyboard('s')
    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('never fires from outside the control, so reading the page is safe', async () => {
    const user = userEvent.setup()
    mountToggle()

    // The letters belong to the control, not to the document: the app claims
    // exactly one global chord (DEC-015), and a bare letter listening on the
    // document would fire while someone was simply reading.
    const away = document.createElement('button')
    document.body.appendChild(away)
    away.focus()
    await user.keyboard('dls')
    expect(document.documentElement.dataset.theme).toBe('system')
    away.remove()
  })

  it('leaves the keystroke alone when it is being typed into a field', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <KeyedContainer />
      </ThemeProvider>,
    )

    const field = screen.getByLabelText('note')
    await user.click(field)
    await user.type(field, 'dark ideas')

    expect(field).toHaveValue('dark ideas')
    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('ignores a letter held with a modifier, which belongs to the browser', async () => {
    const user = userEvent.setup()
    mountToggle()

    screen.getByRole('button', { name: 'System' }).focus()
    await user.keyboard('{Control>}d{/Control}')
    expect(document.documentElement.dataset.theme).toBe('system')
    await user.keyboard('{Meta>}d{/Meta}')
    expect(document.documentElement.dataset.theme).toBe('system')
    await user.keyboard('{Alt>}d{/Alt}')
    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('advertises the letters on the group it belongs to', () => {
    mountToggle()
    expect(screen.getByRole('group', { name: 'Theme' })).toHaveAttribute(
      'aria-keyshortcuts',
      'S L D',
    )
  })
})
