import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error — scripts/perf-check.mjs is plain ESM (narrow documented boundary).
import { checkBudgets } from '../../../scripts/perf-check.mjs'
import type { AgendaSessionRecord } from '../../../src/db/agenda-repository'
import AgendaAdminPage from '../../../src/app/features/admin/AgendaAdminPage'
import { Route as AgendaAdminRoute } from '../../../src/app/routes/admin_.events.$slug_.agenda'
import { loadAgendaDndBoard } from '../../../src/app/features/admin/AgendaDndBoard'

// Agenda admin UI contract: page-owned h1 per state, session list rendering
// from the AgendaSessionRecord shape, keyboard placement/status controls with
// focus retention, generic denial/error copy without raw server leakage,
// dnd-kit lazy-only, and a 40,000 B gzip route-chunk budget.

const EVENT_SLUG = 'demo-conf-2026'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const AGENDA_URL = `/api/admin/events/${EVENT_SLUG}/agenda`
const AGENDA_ADMIN_ROUTE = '/admin/events/$slug/agenda'
const AGENDA_ADMIN_ROUTE_GZIP_BUDGET_BYTES = 40_000

const AGENDA_SESSION: AgendaSessionRecord = {
  eventId: EVENT_ID,
  submissionId: 'submission-1',
  trackId: 'tax-track-talks',
  roomId: 'tax-room-main-hall',
  day: '2026-05-13',
  start: '2026-05-13T09:00:00.000Z',
  end: '2026-05-13T10:00:00.000Z',
  position: 0,
  status: 'published',
  assignment: 'scheduled',
  speakerIds: ['contact-1'],
  createdAt: '2026-08-09T12:00:00.000Z',
  updatedAt: '2026-08-09T12:00:00.000Z',
}

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response | Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

type AgendaState = 'loading' | 'error' | 'denied' | 'empty' | 'ready'

async function mountPage(state: AgendaState) {
  if (state === 'loading') {
    fetchHandler = () => new Promise<Response>(() => undefined)
  } else if (state === 'error') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === AGENDA_URL) {
        return jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else if (state === 'denied') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === AGENDA_URL) {
        return jsonResponse(
          { error: { code: 'forbidden', message: 'Access denied raw copy' } },
          403,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else if (state === 'empty') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === AGENDA_URL) {
        return jsonResponse([])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === AGENDA_URL) {
        return jsonResponse([AGENDA_SESSION])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <AgendaAdminPage eventSlug={EVENT_SLUG} />
    </QueryClientProvider>,
  )
  return { queryClient }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === AGENDA_URL) {
      return jsonResponse([AGENDA_SESSION])
    }
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return fetchHandler(requestUrl(input), init)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('agenda admin UI', () => {
  it('exposes the planned admin component and route surfaces', () => {
    expect(AgendaAdminPage).toBeTypeOf('function')
    expect(AgendaAdminRoute.options.path).toBe(AGENDA_ADMIN_ROUTE)
    expect(AgendaAdminRoute.options.component).toBeTypeOf('function')
  })

  it.each([
    ['ready', 'Agenda'],
    ['empty', 'Agenda'],
    ['error', 'Agenda'],
  ] as const)(
    'renders exactly one page-owned h1 in the %s state, never the brand',
    async (state, title) => {
      await mountPage(state)

      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
      const h1s = screen.getAllByRole('heading', { level: 1 })
      expect(h1s).toHaveLength(1)
      expect(h1s[0]).not.toHaveTextContent('SpeakerOps')
    },
  )

  it('keeps the loading state heading-free (zero h1s, aria-busy skeleton)', async () => {
    await mountPage('loading')

    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('renders the session list from the repository shape (day/start/end/room/track/position/status)', async () => {
    await mountPage('ready')

    await screen.findByText(AGENDA_SESSION.submissionId)
    expect(screen.getByText(AGENDA_SESSION.day)).toBeInTheDocument()
    expect(screen.getByText(AGENDA_SESSION.start)).toBeInTheDocument()
    expect(screen.getByText(AGENDA_SESSION.end)).toBeInTheDocument()
    expect(screen.getByText(String(AGENDA_SESSION.roomId))).toBeInTheDocument()
    expect(screen.getByText(String(AGENDA_SESSION.trackId))).toBeInTheDocument()
    expect(screen.getByText(String(AGENDA_SESSION.position))).toBeInTheDocument()
    expect(screen.getByText(AGENDA_SESSION.status)).toBeInTheDocument()
  })

  it('keeps placement/status controls keyboard-operable and retains focus after a status change', async () => {
    const user = userEvent.setup()
    await mountPage('ready')

    const statusToggle = await screen.findByRole('button', {
      name: new RegExp(`toggle status ${AGENDA_SESSION.submissionId}`, 'i'),
    })
    statusToggle.focus()
    expect(statusToggle).toHaveFocus()
    await user.click(statusToggle)
    expect(statusToggle).toHaveFocus()
    expect(screen.getByRole('button', { name: /move/i })).toBeInTheDocument()
  })

  it('shows generic error copy without raw server leakage', async () => {
    await mountPage('error')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unable to load the agenda/i)
    expect(document.body.textContent ?? '').not.toContain('boom raw server copy')
  })

  it('shows generic denial copy without raw server leakage', async () => {
    await mountPage('denied')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Access forbidden' }),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('Access denied raw copy')
  })

  it('loads the dnd board lazily (dynamic-import boundary, not a static main-chunk import)', () => {
    expect(loadAgendaDndBoard).toBeTypeOf('function')
    const loaded = loadAgendaDndBoard()
    expect(typeof loaded?.then).toBe('function')
  })

  it('caps the agenda-admin route chunk at 40,000 B gzip (D-2 pattern)', () => {
    const overBudget: readonly string[] = checkBudgets({
      [AGENDA_ADMIN_ROUTE]: AGENDA_ADMIN_ROUTE_GZIP_BUDGET_BYTES + 1,
    })
    expect(overBudget.some((violation) => violation.includes(AGENDA_ADMIN_ROUTE))).toBe(true)
    const atBudget: readonly string[] = checkBudgets({
      [AGENDA_ADMIN_ROUTE]: AGENDA_ADMIN_ROUTE_GZIP_BUDGET_BYTES,
    })
    expect(atBudget).toEqual([])
  })
})
