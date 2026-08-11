import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../../../src/app/query-client'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'
import { routeTree } from '../../../src/app/routeTree.gen'
import { DEFAULT_EVENT_SLUG } from '../../../src/app/lib/default-event'
import { ProductTour, TOUR_TOGGLE_EVENT } from '../../../src/app/features/tour/ProductTour'
import { TOUR_STEPS } from '../../../src/app/features/tour/tour-steps'

const STEP_COUNT = TOUR_STEPS.length
const DONE_KEY = 'speakerops:tour-done'

/**
 * jsdom in this project ships no localStorage at all; the tour has to survive
 * that (it guards every access), but the completion-flag tests need a real
 * store to observe, so an in-memory Storage is installed per test.
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

function toggleTour(): void {
  act(() => {
    window.dispatchEvent(new CustomEvent(TOUR_TOGGLE_EVENT))
  })
}

function mountTour() {
  const onNavigate = vi.fn()
  render(<ProductTour onNavigate={onNavigate} />)
  return { onNavigate, user: userEvent.setup() }
}

beforeEach(() => {
  installStorage()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'localStorage')
  cleanup()
})

describe('tour steps', () => {
  it('starts centered, tours the organizer rail, and ends on the public loop', () => {
    expect(TOUR_STEPS[0]?.id).toBe('welcome')
    expect(TOUR_STEPS[0]?.route).toBeUndefined()
    expect(TOUR_STEPS[0]?.target).toBeUndefined()
    expect(TOUR_STEPS.at(-1)?.id).toBe('schedule')
    const ids = TOUR_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('product tour', () => {
  it('opens on the toggle event and closes on the same event', async () => {
    mountTour()
    expect(screen.queryByRole('dialog')).toBeNull()

    toggleTour()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(/welcome to speakerops/i)

    toggleTour()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('renders the popover even when a step has no matching target', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    // admin-signin declares a [data-tour] hook that this test never renders;
    // the popover must appear regardless.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/organizer sign-in/i)
  })

  it('announces its progress politely as "Step N of M"', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    const progress = screen.getByRole('status')
    expect(progress).toHaveTextContent(`Step 1 of ${STEP_COUNT}`)
    expect(progress).toHaveAttribute('aria-live', 'polite')
    expect(progress).not.toHaveAttribute('aria-busy')

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(`Step 2 of ${STEP_COUNT}`),
    )
  })

  it('traverses forward with Next and back with Back', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    expect(screen.getByRole('button', { name: /^back$/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/organizer sign-in/i)

    await user.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/welcome to speakerops/i)
  })

  it('navigates a route-bearing step with the exact route and params', async () => {
    const { onNavigate, user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')
    expect(onNavigate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/admin', undefined))

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith('/admin/events/$slug', {
        slug: DEFAULT_EVENT_SLUG,
      }),
    )
  })

  it('closes on Escape without marking the tour done', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull()
  })

  it('finishes with Done on the last step and records completion', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    for (let index = 0; index < STEP_COUNT - 1; index += 1) {
      await user.click(screen.getByRole('button', { name: /^next$/i }))
    }
    expect(screen.getByRole('status')).toHaveTextContent(`Step ${STEP_COUNT} of ${STEP_COUNT}`)

    await user.click(screen.getByRole('button', { name: /^done$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.localStorage.getItem(DONE_KEY)).toBe('true')
  })

  it('records completion when the tour is skipped', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: /skip tour/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.localStorage.getItem(DONE_KEY)).toBe('true')
  })

  it('moves focus to the popover on open and keeps it inside on step change', async () => {
    const { user } = mountTour()
    toggleTour()
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog).toHaveFocus())

    // Advancing must NOT yank focus back to the container: a keyboard user on
    // Next stays on Next; the live region announces the step change instead.
    const next = screen.getByRole('button', { name: /^next$/i })
    await user.click(next)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    })
  })

  it('returns focus to the opener when the tour closes', async () => {
    const { user } = mountTour()
    const opener = document.createElement('button')
    opener.textContent = 'Open tour'
    document.body.appendChild(opener)
    opener.focus()
    try {
      toggleTour()
      await screen.findByRole('dialog')

      await user.click(screen.getByRole('button', { name: /skip tour/i }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(opener).toHaveFocus()
    } finally {
      opener.remove()
    }
  })

  it('never opens by itself', async () => {
    mountTour()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('tour header affordance', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'internal' } }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens the tour from the Tour button in the site header', async () => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    render(
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <RouterProvider router={router as any} />
        </QueryClientProvider>
        <ProductTour onNavigate={vi.fn()} />
      </ThemeProvider>,
    )
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^tour$/i }))
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/welcome to speakerops/i)

    await user.click(screen.getByRole('button', { name: /^tour$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
