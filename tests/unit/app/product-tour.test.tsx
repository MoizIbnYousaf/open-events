import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../../../src/app/query-client'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'
import { routeTree } from '../../../src/app/routeTree.gen'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../../src/app/lib/default-event'
import { ProductTour, TOUR_TOGGLE_EVENT } from '../../../src/app/features/tour/ProductTour'
import { TOUR_ROUTE_EVENT } from '../../../src/app/features/tour/tour-events'
import { isTourActive } from '../../../src/app/features/tour/tour-activity'
import { TOUR_LEASE_KEY } from '../../../src/app/features/tour/tour-lease'
import { organizerDestinations } from '../../../src/app/features/nav/nav-model'
import {
  TOUR_ORGANIZER_HOLD,
  TOUR_SIGN_IN_STEP_INDEX,
  TOUR_STEPS,
  publicResumeIndexAfter,
} from '../../../src/app/features/tour/tour-steps'

const STEP_COUNT = TOUR_STEPS.length
const DONE_KEY = 'open-events:tour-done'
const PROGRESS_KEY = 'open-events:tour-progress'
/** The gate waits out the tour's real 2s target poll, then re-checks at 400ms. */
const TARGET_POLL_MS = 2000
const HOLD_RECHECK_MS = 400
const GATE_TIMEOUT = 6000
const GATE_TEST_TIMEOUT = 20_000

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
  const onNavigate = vi.fn((route: string, params?: Readonly<Record<string, string>>) => {
    const path = route.replace(
      /\$([A-Za-z0-9_]+)/g,
      (segment, name: string) => params?.[name] ?? segment,
    )
    window.history.pushState(window.history.state, '', path)
  })
  render(<ProductTour onNavigate={onNavigate} />)
  return { onNavigate, user: userEvent.setup() }
}

/**
 * A [data-tour] hook with layout. jsdom lays nothing out and the tour treats a
 * zero-size rect as "no target", so a stand-in for a rendered organizer rail
 * has to supply the two DOM facts the tour actually reads.
 */
function mountTourTarget(id: string): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('data-tour', id)
  element.getBoundingClientRect = () =>
    ({
      top: 40,
      left: 8,
      width: 200,
      height: 30,
      right: 208,
      bottom: 70,
      x: 8,
      y: 40,
      toJSON: () => ({}),
    }) as DOMRect
  element.scrollIntoView = () => {}
  document.body.appendChild(element)
  return element
}

/**
 * Walk a signed-out visitor to the first organizer step and wait for the hold.
 * Nothing renders a `rail-*` hook here, which is precisely the signed-out
 * organizer route: it returns a state card instead of its rail.
 */
async function holdAtTheOrganizerGate(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('dialog')
  await user.click(screen.getByRole('button', { name: /^next$/i }))
  await user.click(screen.getByRole('button', { name: /^next$/i }))
  await waitFor(
    () =>
      expect(screen.getByRole('dialog')).toHaveAccessibleName(/organizer access needs attention/i),
    { timeout: GATE_TIMEOUT },
  )
}

beforeEach(() => {
  window.history.replaceState(window.history.state, '', '/')
  installStorage()
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : new Response(
              JSON.stringify({
                mode: 'ready',
                expiresAt: '2026-08-16T07:00:00.000Z',
                eventSlug: DEFAULT_EVENT_SLUG,
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
      ),
    ),
  )
})

afterEach(() => {
  Reflect.deleteProperty(window, 'localStorage')
  vi.unstubAllGlobals()
  cleanup()
})

describe('tour steps', () => {
  it('starts centered, tours the organizer rail, and ends on the public loop', () => {
    expect(TOUR_STEPS[0]?.id).toBe('welcome')
    expect(TOUR_STEPS[0]?.route).toBeUndefined()
    expect(TOUR_STEPS[0]?.target).toBeUndefined()
    expect(TOUR_STEPS.at(-1)?.id).toBe('itinerary')
    const ids = TOUR_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // R1-B5: the organizer half of the tour is the half a signed-out visitor
  // cannot see, and every one of those steps has to say so in the data.
  it('marks every organizer rail step as session-gated and leaves the public loop open', () => {
    const gated = TOUR_STEPS.filter((step) => step.requiresSession !== undefined)
    const gatedIds = gated.map((step) => step.id)
    for (const destination of organizerDestinations(DEFAULT_EVENT_SLUG)) {
      expect(gatedIds).toContain(destination.id)
    }
    // Every gated step carries a real rendered hook. Rail destinations use
    // the shared rail hook; deeper lifecycle workspaces own a page hook.
    for (const step of gated) expect(step.target).toBeTruthy()
  })

  it('covers every organizer destination and the complete public and persona loop', () => {
    const ids = TOUR_STEPS.map((step) => step.id)
    const organizerIds = organizerDestinations(DEFAULT_EVENT_SLUG).map(
      (destination) => destination.id,
    )

    expect(ids).toEqual(expect.arrayContaining(organizerIds))
    expect(ids).toEqual(
      expect.arrayContaining([
        'public-cfp',
        'cfp-builder',
        'submission-workspace',
        'start',
        'speaker-portal',
        'reviewer-queue',
        'session-catalogue',
        'speaker-gallery',
        'schedule',
      ]),
    )
  })

  // V-B5-COPY, unpinned until now (RV3 NEW-3). The hold used to promise the
  // tour "picks up right here" after signing in; it does not — it waits on the
  // reader's Next, which was measured live. A string is the easiest fix to
  // regress silently, so the instruction the product actually keeps is pinned
  // here and the promise it does not keep is pinned out.
  it('offers truthful organizer recovery without promising an automatic resume', () => {
    expect(TOUR_ORGANIZER_HOLD.body).toMatch(/retry/i)
    expect(TOUR_ORGANIZER_HOLD.body).not.toMatch(/picks up|pick up/i)
    expect(TOUR_ORGANIZER_HOLD.body).toMatch(/sign-in door/i)
    expect(TOUR_ORGANIZER_HOLD.body).toMatch(/public chapters/i)
  })

  it('derives both recovery doors from the list rather than hard-coding them', () => {
    expect(TOUR_STEPS[TOUR_SIGN_IN_STEP_INDEX]?.id).toBe('admin-signin')
    // The resume door skips the routeless palette step: a step with no route of
    // its own would narrate over whatever denied page is already on screen.
    const resume = publicResumeIndexAfter(TOUR_SIGN_IN_STEP_INDEX + 1)
    expect(TOUR_STEPS[resume]?.id).toBe('public-cfp')
    expect(TOUR_STEPS[resume]?.route).toBeDefined()
    expect(publicResumeIndexAfter(TOUR_STEPS.length - 1)).toBe(-1)
  })
})

describe('product tour', () => {
  it('opens on the toggle event and closes on the same event', async () => {
    mountTour()
    expect(screen.queryByRole('dialog')).toBeNull()

    toggleTour()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(/from proposal to programme/i)

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

  it('shows the current journey and a visual progress rail', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    expect(screen.getByText('Overview journey')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Tour progress' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    )

    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(await screen.findByText('Overview journey')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Tour progress' })).toHaveAttribute(
      'aria-valuenow',
      '2',
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
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/from proposal to programme/i)
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
    expect(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}')).toMatchObject({
      stepId: 'welcome',
      status: 'paused',
    })
  })

  it('pauses at the current step and resumes there with fresh role access', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/event overview/i)

    await user.click(screen.getByRole('button', { name: /pause tour/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}')).toMatchObject({
      stepId: 'event-settings',
      status: 'paused',
    })

    toggleTour()
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/event overview/i)
    expect(screen.getByRole('status')).toHaveTextContent(`Step 3 of ${STEP_COUNT}`)
    expect(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}')).toMatchObject({
      stepId: 'event-settings',
      status: 'active',
    })

    const requests = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input) === '/api/tour/session')
    const lastPost = requests.findLast(([, init]) => init?.method === 'POST')
    expect(lastPost?.[1]?.body).toBe(JSON.stringify({ access: 'organizer' }))
  })

  it('keeps a paused checkpoint across remounts without auto-opening', async () => {
    window.localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ version: 1, stepId: 'start', status: 'paused' }),
    )
    const first = mountTour()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).toBeNull()

    toggleTour()
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/role-specific access/i)
    expect(first.onNavigate).toHaveBeenCalledWith('/start', undefined)
  })

  it('keeps the coach visible until authority cleanup finishes', async () => {
    let finishDelete: (() => void) | undefined
    let deleteCalls = 0
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleteCalls += 1
        if (deleteCalls !== 2) return Promise.resolve(new Response(null, { status: 204 }))
        return new Promise<Response>((resolve) => {
          finishDelete = () => resolve(new Response(null, { status: 204 }))
        })
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            mode: 'ready',
            expiresAt: '2026-08-16T07:00:00.000Z',
            eventSlug: DEFAULT_EVENT_SLUG,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })

    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /pause tour/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      0,
    )
    finishDelete?.()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    toggleTour()
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/from proposal to programme/i)
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(
      0,
    )
  })

  it('supersedes a delayed role response and revokes it after Pause', async () => {
    let finishPost: (() => void) | undefined
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          finishPost = () =>
            resolve(
              new Response(
                JSON.stringify({
                  mode: 'ready',
                  expiresAt: '2026-08-16T07:00:00.000Z',
                  eventSlug: DEFAULT_EVENT_SLUG,
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
              ),
            )
        })
      }
      return Promise.resolve(new Response(null, { status: 204 }))
    })

    const { onNavigate, user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST'),
      ).toHaveLength(1),
    )

    await user.click(screen.getByRole('button', { name: /pause tour/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    finishPost?.()

    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE'),
      ).toHaveLength(3),
    )
    expect(onNavigate).not.toHaveBeenCalledWith('/admin/events/$slug', expect.anything())
    expect(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}')).toMatchObject({
      stepId: 'admin-signin',
      status: 'paused',
    })
  })

  it('uses keepalive cleanup on page exit', async () => {
    mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([, init]) => init?.method === 'DELETE' && init.keepalive === true),
      ).toBe(true),
    )
  })

  it('pauses locally when another tab takes the lease without revoking its authority', async () => {
    const { onNavigate } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')
    const deletesBefore = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === 'DELETE').length

    window.localStorage.setItem(
      TOUR_LEASE_KEY,
      JSON.stringify({ tabId: 'another-tab', expiresAt: Date.now() + 15_000 }),
    )
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: TOUR_LEASE_KEY,
        newValue: window.localStorage.getItem(TOUR_LEASE_KEY),
      }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onNavigate).toHaveBeenLastCalledWith('/')
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE'),
    ).toHaveLength(deletesBefore)
  })

  it('pauses at the exact checkpoint when manual navigation diverges from narration', async () => {
    const { onNavigate, user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Organizer sign-in')
    const deletesBefore = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === 'DELETE').length

    window.dispatchEvent(new CustomEvent(TOUR_ROUTE_EVENT, { detail: '/sessions/demo-conf-2026' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onNavigate).toHaveBeenLastCalledWith('/')
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE'),
    ).toHaveLength(deletesBefore + 1)
    expect(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? '{}')).toMatchObject({
      stepId: 'admin-signin',
      status: 'paused',
    })
  })

  it('finishes with Done on the last step and records completion', async () => {
    // The straight walk through all twelve steps is the signed-in organizer's
    // walk, so the rail its gated steps look for is on screen throughout.
    const rails = TOUR_STEPS.filter(
      (step) => step.targetPolicy === 'required' && step.target !== undefined,
    ).map((step) => mountTourTarget(step.target ?? ''))
    try {
      const { user } = mountTour()
      toggleTour()
      await screen.findByRole('dialog')

      for (let index = 0; index < STEP_COUNT - 1; index += 1) {
        await user.click(screen.getByRole('button', { name: /^next$/i }))
      }
      expect(screen.getByRole('status')).toHaveTextContent(`Step ${STEP_COUNT} of ${STEP_COUNT}`)

      await user.click(screen.getByRole('button', { name: /^done$/i }))
      expect(
        await screen.findByRole('heading', { name: /one proposal, ready for an audience/i }),
      ).toBeInTheDocument()
      expect(window.localStorage.getItem(DONE_KEY)).toBe('true')
      expect(window.localStorage.getItem(PROGRESS_KEY)).toBeNull()
    } finally {
      for (const rail of rails) rail.remove()
    }
  })

  it('ends without claiming completion', async () => {
    const { user } = mountTour()
    toggleTour()
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: /end tour/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.localStorage.getItem(DONE_KEY)).toBeNull()
    expect(window.localStorage.getItem(PROGRESS_KEY)).toBeNull()
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

      await user.click(screen.getByRole('button', { name: /end tour/i }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(opener).toHaveFocus()
    } finally {
      opener.remove()
    }
  })

  // F-R4-4. The exact repro: tour step 2 lands on /admin, whose secret field
  // took focus inside a <form>, and Escape then hit the input's scope bail —
  // leaving the tour keyboard-undismissable.
  it('closes on Escape while focus sits in a field on the page underneath', async () => {
    const { user } = mountTour()
    const form = document.createElement('form')
    const input = document.createElement('input')
    input.type = 'password'
    form.appendChild(input)
    document.body.appendChild(form)
    try {
      toggleTour()
      await screen.findByRole('dialog')

      input.focus()
      await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } finally {
      form.remove()
    }
  })

  // F-R4-4, the other half: the flag AdminLogin reads before taking focus.
  it('publishes a tour-active flag while it narrates and clears it on close', async () => {
    const { user } = mountTour()
    expect(isTourActive()).toBe(false)

    toggleTour()
    await screen.findByRole('dialog')
    expect(isTourActive()).toBe(true)

    await user.click(screen.getByRole('button', { name: /end tour/i }))
    await waitFor(() => expect(isTourActive()).toBe(false))
  })

  it(
    'holds for a sign-in instead of narrating an organizer screen that never rendered',
    async () => {
      const { onNavigate, user } = mountTour()
      toggleTour()
      await holdAtTheOrganizerGate(user)

      // R1-B5: it entered the first organizer route, found no rail, and stopped
      // there — the counter stays honest and the forward door is no longer
      // "Next" into another forbidden page.
      expect(screen.getByRole('status')).toHaveTextContent(`Step 3 of ${STEP_COUNT}`)
      expect(screen.queryByRole('button', { name: /^next$/i })).toBeNull()
      expect(screen.getByRole('button', { name: /back to sign-in/i })).toBeEnabled()
      expect(
        screen.getByRole('button', { name: /continue with public chapters/i }),
      ).toBeInTheDocument()
      expect(onNavigate).not.toHaveBeenCalledWith(
        '/admin/events/$slug/taxonomies',
        expect.anything(),
      )

      // Signing in makes the rail render. The hold is not a dead end: the tour
      // picks the step back up by itself.
      const rail = mountTourTarget('event-overview')
      try {
        await waitFor(
          () => expect(screen.getByRole('dialog')).toHaveAccessibleName(/event overview/i),
          { timeout: GATE_TIMEOUT },
        )
        expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument()
      } finally {
        rail.remove()
      }
    },
    GATE_TEST_TIMEOUT,
  )

  it(
    'waits rather than holding while the organizer route is still loading',
    async () => {
      // A signed-in organizer on a slow connection must never be told to sign
      // in: the route's own aria-busy skeleton says the answer is not in yet.
      const skeleton = document.createElement('div')
      skeleton.setAttribute('aria-busy', 'true')
      document.body.appendChild(skeleton)
      const { user } = mountTour()
      try {
        toggleTour()
        await screen.findByRole('dialog')
        await user.click(screen.getByRole('button', { name: /^next$/i }))
        await user.click(screen.getByRole('button', { name: /^next$/i }))

        await new Promise((resolve) => setTimeout(resolve, TARGET_POLL_MS + HOLD_RECHECK_MS * 3))
        expect(screen.getByRole('dialog')).toHaveAccessibleName(/event overview/i)

        // The query settles into a denied state: the skeleton goes, no rail
        // arrives, and only now is that an answer.
        skeleton.remove()
        await waitFor(
          () =>
            expect(screen.getByRole('dialog')).toHaveAccessibleName(
              /organizer access needs attention/i,
            ),
          { timeout: GATE_TIMEOUT },
        )
      } finally {
        skeleton.remove()
      }
    },
    GATE_TEST_TIMEOUT,
  )

  it(
    'leaves a held organizer chapter for the first public route',
    async () => {
      const { onNavigate, user } = mountTour()
      toggleTour()
      await holdAtTheOrganizerGate(user)

      await user.click(screen.getByRole('button', { name: /continue with public chapters/i }))
      await waitFor(() =>
        expect(onNavigate).toHaveBeenLastCalledWith('/cfp/$eventSlug/$formSlug', {
          eventSlug: DEFAULT_EVENT_SLUG,
          formSlug: DEFAULT_FORM_SLUG,
        }),
      )
      expect(screen.getByRole('dialog')).toHaveAccessibleName(/published call for papers/i)
      const paletteIndex = TOUR_STEPS.findIndex((step) => step.id === 'public-cfp')
      expect(screen.getByRole('status')).toHaveTextContent(
        `Step ${paletteIndex + 1} of ${STEP_COUNT}`,
      )
    },
    GATE_TEST_TIMEOUT,
  )

  it(
    'sends a held tour back to the organizer door when asked',
    async () => {
      const { onNavigate, user } = mountTour()
      toggleTour()
      await holdAtTheOrganizerGate(user)

      await user.click(screen.getByRole('button', { name: /back to sign-in/i }))
      await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith('/admin', undefined))
      expect(screen.getByRole('dialog')).toHaveAccessibleName(/organizer sign-in/i)
      expect(screen.getByRole('status')).toHaveTextContent(
        `Step ${TOUR_SIGN_IN_STEP_INDEX + 1} of ${STEP_COUNT}`,
      )
    },
    GATE_TEST_TIMEOUT,
  )

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
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          String(input) === '/api/tour/session'
            ? init?.method === 'DELETE'
              ? new Response(null, { status: 204 })
              : new Response(
                  JSON.stringify({
                    mode: 'ready',
                    expiresAt: '2026-08-16T07:00:00.000Z',
                    eventSlug: DEFAULT_EVENT_SLUG,
                  }),
                  { status: 200, headers: { 'content-type': 'application/json' } },
                )
            : new Response(JSON.stringify({ error: { code: 'internal' } }), {
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

  it('opens the tour from the Take the tour button in the site header', async () => {
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

    const header = await screen.findByRole('banner')
    await user.click(within(header).getByRole('button', { name: /^take the tour$/i }))
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/from proposal to programme/i)

    await user.click(within(header).getByRole('button', { name: /^take the tour$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('button', { name: /resume tour/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /resume tour/i }))
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/from proposal to programme/i)
  })
})
