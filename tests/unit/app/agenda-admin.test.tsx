import '@testing-library/jest-dom/vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error — scripts/perf-check.mjs is plain ESM (narrow documented boundary).
import { checkBudgets } from '../../../scripts/perf-check.mjs'
import type { AgendaBoardDto, AgendaSessionDto } from '../../../src/application'
import type { EventDates } from '../../../src/domain'
import { buildAgendaGrid, isPlaceableSlot } from '../../../src/domain/agenda'
import AgendaAdminPage from '../../../src/app/features/admin/AgendaAdminPage'
import { Route as AgendaAdminRoute } from '../../../src/app/routes/admin_.events.$slug_.agenda'

// Agenda admin UI contract: page-owned h1 per state, the board rendered from
// the server DTO, a keyboard placement path that really persists (optimistic,
// rolled back on failure) and always follows the stored placement afterwards, a
// publish action, a retraction that takes a session back off the schedule,
// conflicts rendered where they can be resolved and announced when they appear,
// the five organizer views, no control that only moves local state, dnd-kit
// reachable only through a dynamic import, and a 40,000 B gzip route-chunk
// budget. When a placement cannot be made at all, the page names the
// prerequisite that is actually missing — dates, schedulable time, or rooms —
// and links to the surface that fixes it.

const EVENT_SLUG = 'demo-conf-2026'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const AGENDA_URL = `/api/admin/events/${EVENT_SLUG}/agenda`
const PUBLISH_URL = `${AGENDA_URL}/publish`
const AGENDA_ADMIN_ROUTE = '/admin/events/$slug/agenda'
const AGENDA_ADMIN_ROUTE_GZIP_BUDGET_BYTES = 40_000

const ADMIN_FEATURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'app',
  'features',
  'admin',
)

const ROOM_MAIN = { id: 'tax-room-main-hall', key: 'main-hall', label: 'Main hall' }
const ROOM_WORKSHOP = { id: 'tax-room-workshop-a', key: 'workshop-a', label: 'Workshop A' }
const TRACK_TALKS = { id: 'tax-track-talks', key: 'talks', label: 'Talks' }

const UNPLACED: AgendaSessionDto = {
  submissionId: 'submission-1',
  title: 'Scaling Postgres',
  day: '2026-05-13',
  start: '2026-05-13T08:00:00.000Z',
  end: '2026-05-13T09:00:00.000Z',
  roomId: null,
  roomLabel: null,
  trackId: null,
  trackLabel: null,
  position: null,
  status: 'draft',
  assignment: 'unassigned',
}

const PLACED: AgendaSessionDto = {
  ...UNPLACED,
  start: '2026-05-13T09:00:00.000Z',
  end: '2026-05-13T10:00:00.000Z',
  roomId: ROOM_MAIN.id,
  roomLabel: ROOM_MAIN.label,
  trackId: TRACK_TALKS.id,
  trackLabel: TRACK_TALKS.label,
  position: 0,
  assignment: 'scheduled',
}

const SECOND_PLACED: AgendaSessionDto = {
  ...PLACED,
  submissionId: 'submission-2',
  title: 'Postgres at the edge',
  position: 1,
}

const BOARD: AgendaBoardDto = {
  eventId: EVENT_ID,
  slug: EVENT_SLUG,
  timezone: 'Europe/Berlin',
  windowDays: 2,
  days: [
    {
      day: '2026-05-13',
      slots: [
        { startTime: '08:00', endTime: '09:00' },
        { startTime: '09:00', endTime: '10:00' },
      ],
    },
    { day: '2026-05-14', slots: [{ startTime: '09:00', endTime: '10:00' }] },
  ],
  rooms: [ROOM_MAIN, ROOM_WORKSHOP],
  tracks: [TRACK_TALKS],
  sessions: [UNPLACED],
  conflicts: [],
  views: { list: [], day: {}, week: {}, track: {}, room: {} },
}

const PLACED_BOARD: AgendaBoardDto = {
  ...BOARD,
  sessions: [PLACED],
  views: {
    list: [PLACED.submissionId],
    day: { '2026-05-13': [PLACED.submissionId] },
    week: { '2026-W20': [PLACED.submissionId] },
    track: { [TRACK_TALKS.id]: [PLACED.submissionId] },
    room: { [ROOM_MAIN.id]: [PLACED.submissionId] },
  },
}

const CONFLICT_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [PLACED, SECOND_PLACED],
  conflicts: [{ kind: 'room', first: PLACED.submissionId, second: SECOND_PLACED.submissionId }],
}

// A session placed without a track. The board keys its group by the identifier
// it does not have, and the views have to name that group rather than leave it
// blank under whichever track was drawn before it.
const UNTRACKED: AgendaSessionDto = {
  ...PLACED,
  submissionId: 'submission-untracked',
  title: 'Hallway track',
  trackId: null,
  trackLabel: null,
  position: 1,
}

const UNTRACKED_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [PLACED, UNTRACKED],
  views: {
    ...PLACED_BOARD.views,
    list: [PLACED.submissionId, UNTRACKED.submissionId],
    track: { [TRACK_TALKS.id]: [PLACED.submissionId], '': [UNTRACKED.submissionId] },
  },
}

// One session still to publish, one already on the programme, and a room they
// both hold: the exact state whose confirmation used to overcount the sessions
// and say nothing at all about the double booking.
const PART_PUBLISHED_CONFLICT_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [PLACED, { ...SECOND_PLACED, status: 'published' }],
  conflicts: [{ kind: 'room', first: PLACED.submissionId, second: SECOND_PLACED.submissionId }],
}

const SECOND_UNPLACED: AgendaSessionDto = {
  ...UNPLACED,
  submissionId: SECOND_PLACED.submissionId,
  title: SECOND_PLACED.title,
}

const ABOUT_TO_CLASH_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [PLACED, SECOND_UNPLACED],
}

/** Two rows that can both be placed: the shape a page-wide flag gets wrong. */
const TWO_UNPLACED_BOARD: AgendaBoardDto = {
  ...BOARD,
  sessions: [UNPLACED, SECOND_UNPLACED],
}

/** One placed row to remove, one unplaced row that must stay idle while it is. */
const MIXED_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [PLACED, { ...SECOND_UNPLACED, submissionId: 'submission-3' }],
}

// An event whose dates are still unset yields no grid at all: the server
// derives the days from the event window alone, so none arrive.
const UNDATED_BOARD: AgendaBoardDto = { ...BOARD, days: [], windowDays: 0 }

const UNDATED_PLACED_BOARD: AgendaBoardDto = { ...PLACED_BOARD, days: [], windowDays: 0 }

const UNDATED_CONFLICT_BOARD: AgendaBoardDto = { ...CONFLICT_BOARD, days: [], windowDays: 0 }

// Dates that ARE set, over a window too short to hold one session: the days
// are real, and every one of them offers nothing.
const NO_TIME_BOARD: AgendaBoardDto = {
  ...BOARD,
  windowDays: 1,
  days: [{ day: '2026-05-13', slots: [] }],
}

// Dates and slots both real; the taxonomy simply has no room yet. Acceptance
// materialises agenda rows without consulting the taxonomy, so this is an
// ordinary state, not a corrupt one.
const NO_ROOMS_BOARD: AgendaBoardDto = { ...BOARD, rooms: [] }

const NO_ROOMS_PLACED_BOARD: AgendaBoardDto = { ...PLACED_BOARD, rooms: [] }

// A stored placement the board can no longer express: the session sits on
// 2026-05-15 at 16:00 and the window the grid comes from now stops on
// 2026-05-14. The organizer trimmed the event around a session that was already
// placed, which is an ordinary thing to do and not a corrupt row.
const OFF_GRID_DAY_PLACED: AgendaSessionDto = {
  ...PLACED,
  day: '2026-05-15',
  start: '2026-05-15T16:00:00.000Z',
  end: '2026-05-15T17:00:00.000Z',
}

const OFF_GRID_DAY_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [OFF_GRID_DAY_PLACED],
}

// The same situation reached the other way: the day is still on the board, but
// the event now opens later, so the time the session holds is not a slot of it.
const OFF_GRID_TIME_PLACED: AgendaSessionDto = {
  ...PLACED,
  start: '2026-05-13T15:00:00.000Z',
  end: '2026-05-13T16:00:00.000Z',
}

const OFF_GRID_TIME_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [OFF_GRID_TIME_PLACED],
}

// And the same situation reached through the END alone: the day and the start
// time are both still on the board, but the session runs ninety minutes and the
// board offers hour-long slots, so no slot of that day expresses it.
const OFF_GRID_END_PLACED: AgendaSessionDto = {
  ...PLACED,
  start: '2026-05-13T09:00:00.000Z',
  end: '2026-05-13T10:30:00.000Z',
}

const OFF_GRID_END_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [OFF_GRID_END_PLACED],
}

// A window longer than the board draws: 32 days from 2026-05-13, of which this
// board lists the first two. 2026-05-20 is inside that window and the server
// takes a placement on it — the board simply stops short of drawing it.
const CAPPED_PLACED: AgendaSessionDto = {
  ...PLACED,
  day: '2026-05-20',
  start: '2026-05-20T09:00:00.000Z',
  end: '2026-05-20T10:00:00.000Z',
}

const CAPPED_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  windowDays: 32,
  sessions: [CAPPED_PLACED],
}

// An unplaced session carries a placeholder day and start that the grid need
// not offer either — but it claims no placement, so nothing contradicts it.
const OFF_GRID_UNPLACED: AgendaSessionDto = {
  ...UNPLACED,
  day: '2026-05-15',
  start: '2026-05-15T16:00:00.000Z',
  end: '2026-05-15T17:00:00.000Z',
}

const OFF_GRID_UNPLACED_BOARD: AgendaBoardDto = {
  ...BOARD,
  sessions: [OFF_GRID_UNPLACED],
}

// A placement whose room the board no longer carries. Saving the taxonomy
// replaces every room and track and the ids come back fresh, so adding one room
// — or renaming one track — after a placement exists leaves that placement
// pointing at ids nothing on the board matches, and the server can no longer
// label them. The session is still scheduled and still published: it is on the
// public programme, and the only way to take it off is to remove it.
const REMINTED_ROOM_ID = 'tax-room-main-hall-reminted'
const REMINTED_TRACK_ID = 'tax-track-talks-reminted'

const ORPHANED_PLACED: AgendaSessionDto = {
  ...PLACED,
  status: 'published',
  roomId: REMINTED_ROOM_ID,
  roomLabel: null,
  trackId: REMINTED_TRACK_ID,
  trackLabel: null,
}

const ORPHANED_BOARD: AgendaBoardDto = {
  ...PLACED_BOARD,
  sessions: [ORPHANED_PLACED],
}

// The same orphaned placement on a board that has lost its rooms altogether, so
// the placement controls are not rendered at all and removal is the only action
// left.
const ORPHANED_NO_ROOMS_BOARD: AgendaBoardDto = { ...ORPHANED_BOARD, rooms: [] }

interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly body: unknown
}

let requests: RecordedRequest[]
let fetchHandler: (request: RecordedRequest) => Response | Promise<Response>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function boardHandler(board: AgendaBoardDto): (request: RecordedRequest) => Response {
  return (request) => {
    if (request.method === 'GET' && request.url === AGENDA_URL) return jsonResponse(board)
    return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
  }
}

type AgendaState =
  'loading' | 'error' | 'denied' | 'empty' | 'undated' | 'no-time' | 'no-rooms' | 'ready'

// The page links an organizer to the surface that fixes a missing prerequisite,
// so it renders inside a router that really has those routes.
async function renderPage() {
  const rootRoute = createRootRoute()
  const agendaRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: AGENDA_ADMIN_ROUTE,
    component: () => <AgendaAdminPage eventSlug={EVENT_SLUG} />,
  })
  const eventSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug',
    component: () => <div>Event settings</div>,
  })
  const taxonomiesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/taxonomies',
    component: () => <div>Taxonomy editor</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([agendaRoute, eventSettingsRoute, taxonomiesRoute]),
    history: createMemoryHistory({ initialEntries: [`/admin/events/${EVENT_SLUG}/agenda`] }),
  })
  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { queryClient }
}

async function mountPage(state: AgendaState) {
  if (state === 'loading') {
    fetchHandler = () => new Promise<Response>(() => undefined)
  } else if (state === 'error') {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
  } else if (state === 'denied') {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'forbidden', message: 'Access denied raw copy' } }, 403)
  } else if (state === 'empty') {
    fetchHandler = boardHandler({ ...BOARD, sessions: [] })
  } else if (state === 'undated') {
    fetchHandler = boardHandler(UNDATED_BOARD)
  } else if (state === 'no-time') {
    fetchHandler = boardHandler(NO_TIME_BOARD)
  } else if (state === 'no-rooms') {
    fetchHandler = boardHandler(NO_ROOMS_BOARD)
  } else {
    fetchHandler = boardHandler(BOARD)
  }
  return await renderPage()
}

/** The placement form of one session, once the board has rendered. */
async function placementForm(title: string): Promise<HTMLElement> {
  return await screen.findByRole('form', { name: new RegExp(`placement for ${title}`, 'i') })
}

/**
 * Removing a placement and publishing the agenda both pass through a
 * confirmation now: the first takes a session off a programme an audience may
 * already be reading, and the second puts every scheduled session in front of
 * one. The confirm control carries a label of its own — the trigger says what
 * it is about to open, the dialog says what the answer does — so the two are
 * never the same button.
 */
async function confirmIn(user: ReturnType<typeof userEvent.setup>, label: string): Promise<void> {
  await user.click(await screen.findByRole('button', { name: label }))
}

beforeEach(() => {
  requests = []
  fetchHandler = boardHandler(BOARD)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request: RecordedRequest = {
        method: init?.method ?? 'GET',
        url: requestUrl(input),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      }
      requests.push(request)
      return await fetchHandler(request)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('agenda admin surfaces', () => {
  it('exposes the planned admin component and route surfaces', () => {
    expect(AgendaAdminPage).toBeTypeOf('function')
    expect(AgendaAdminRoute.options.path).toBe(AGENDA_ADMIN_ROUTE)
    expect(AgendaAdminRoute.options.component).toBeTypeOf('function')
  })

  it.each([
    ['ready', 'Agenda'],
    ['empty', 'Agenda'],
    ['undated', 'Agenda'],
    ['no-time', 'Agenda'],
    ['no-rooms', 'Agenda'],
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

  // aria-busy is a state, not a live region: on its own it is spoken by nothing,
  // and this state is deliberately heading-free, so without an announcement a
  // screen-reader user is told nothing at all while the board loads.
  it('keeps the loading state heading-free (zero h1s, aria-busy skeleton and a status)', async () => {
    await mountPage('loading')

    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    const busy = document.querySelector('[aria-busy="true"]')
    expect(busy).not.toBeNull()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/loading the agenda/i)
    expect(busy?.contains(status)).toBe(true)
  })

  it('shows generic error copy with a retry that really refetches', async () => {
    const user = userEvent.setup()
    await mountPage('error')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unable to load the agenda/i)
    expect(document.body.textContent ?? '').not.toContain('boom raw server copy')

    fetchHandler = boardHandler(BOARD)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await placementForm(UNPLACED.title)).toBeInTheDocument()
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(2)
  })

  it('shows generic denial copy without raw server leakage', async () => {
    await mountPage('denied')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Access forbidden' }),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('Access denied raw copy')
  })

  // Every other organizer route hands an expired session back to sign-in. The
  // agenda used to fall through to "Unable to load the agenda" with a Retry
  // that could only 401 again — a dead end wearing a button.
  it('hands an expired session back to sign-in instead of a retry that cannot work', async () => {
    fetchHandler = () =>
      jsonResponse({ error: { code: 'unauthorized', message: 'raw session copy' } }, 401)
    await renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Session expired' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('raw session copy')
  })

  it('tells the organizer when nothing has been accepted yet', async () => {
    await mountPage('empty')

    // The loading state announces itself as well, so this waits for the empty
    // state's own copy rather than for whichever status arrives first.
    expect(await screen.findByText(/no accepted sessions/i)).toHaveAttribute('role', 'status')
  })

  it('wears the same empty-state grammar as every other empty surface', async () => {
    await mountPage('empty')
    await screen.findByText(/no accepted sessions/i)

    // Icon tile, title, explanation — the anatomy the primitive documents and
    // the submissions queue already renders. Without the tile a judge walking
    // Submissions → Agenda meets two different empty boxes for one product.
    const empty = document.querySelector('[data-slot="empty-state"]')
    expect(empty).not.toBeNull()
    expect(empty?.querySelector('[data-slot="empty-state-icon"]')).not.toBeNull()
    expect(empty?.querySelector('[data-slot="empty-state-description"]')).not.toBeNull()
    // The tile is decoration; the title is what speaks.
    expect(empty?.querySelector('[data-slot="empty-state-icon"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })
})

describe('agenda placement', () => {
  it('places a session from the keyboard and persists it through the API', async () => {
    const user = userEvent.setup()
    await mountPage('ready')
    const form = await placementForm(UNPLACED.title)

    await user.selectOptions(within(form).getByLabelText('Room'), ROOM_MAIN.id)
    await user.selectOptions(within(form).getByLabelText('Start'), '09:00')
    await user.selectOptions(within(form).getByLabelText('Track'), TRACK_TALKS.id)
    fetchHandler = (request) => {
      if (request.method === 'PUT') return jsonResponse(PLACED_BOARD)
      return jsonResponse(PLACED_BOARD)
    }
    await user.click(within(form).getByRole('button', { name: /place/i }))

    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1)
    })
    expect(requests.find((request) => request.method === 'PUT')).toEqual({
      method: 'PUT',
      url: `${AGENDA_URL}/${UNPLACED.submissionId}`,
      body: {
        day: '2026-05-13',
        roomId: ROOM_MAIN.id,
        trackId: TRACK_TALKS.id,
        start: '2026-05-13T09:00:00.000Z',
        end: '2026-05-13T10:00:00.000Z',
      },
    })
    expect(
      await within(await placementForm(UNPLACED.title)).findByText(
        new RegExp(`placed in ${ROOM_MAIN.label}`, 'i'),
      ),
    ).toBeInTheDocument()
  })

  it('offers the start times of the day that is chosen, never another day’s', async () => {
    const user = userEvent.setup()
    await mountPage('ready')
    const form = await placementForm(UNPLACED.title)
    const startTimes = (): readonly string[] =>
      within(within(form).getByLabelText('Start'))
        .getAllByRole('option')
        .map((option) => option.textContent ?? '')

    expect(startTimes()).toEqual(['08:00', '09:00'])

    // 2026-05-14 opens at 09:00, so 08:00 is not a start it can be given, and
    // the select cannot be left holding one.
    await user.selectOptions(within(form).getByLabelText('Day'), '2026-05-14')
    expect(startTimes()).toEqual(['09:00'])
    expect(within(form).getByLabelText('Start')).toHaveValue('09:00')

    await user.selectOptions(within(form).getByLabelText('Room'), ROOM_MAIN.id)
    fetchHandler = () => jsonResponse(PLACED_BOARD)
    await user.click(within(form).getByRole('button', { name: /place/i }))

    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1)
    })
    expect(requests.find((request) => request.method === 'PUT')?.body).toMatchObject({
      day: '2026-05-14',
      start: '2026-05-14T09:00:00.000Z',
      end: '2026-05-14T10:00:00.000Z',
    })
  })

  it('keeps every placement control reachable by keyboard alone', async () => {
    const user = userEvent.setup()
    await mountPage('ready')
    const form = await placementForm(UNPLACED.title)
    const day = within(form).getByLabelText('Day')

    expect(day).toBeRequired()
    expect(within(form).getByLabelText('Room')).toBeRequired()
    expect(within(form).getByLabelText('Start')).toBeRequired()

    day.focus()
    expect(day).toHaveFocus()
    await user.tab()
    expect(within(form).getByLabelText('Room')).toHaveFocus()
    await user.tab()
    expect(within(form).getByLabelText('Start')).toHaveFocus()
    await user.tab()
    expect(within(form).getByLabelText('Track')).toHaveFocus()
    await user.tab()
    expect(within(form).getByRole('button', { name: /place/i })).toHaveFocus()
  })

  it('keeps the four placement controls on a line of their own', async () => {
    await mountPage('ready')
    const form = await placementForm(UNPLACED.title)

    // jsdom has no layout, so the pin is on the contract that produces it: the
    // control grid takes the full width of the wrapping row instead of
    // competing with the buttons for what they leave. As a `flex-1` item it was
    // handed the 50px left over at 390px — four selects one character wide.
    const grid = within(form).getByLabelText('Day').closest('div.grid')
    expect(grid).not.toBeNull()
    expect(grid?.className).toContain('w-full')
    expect(grid?.className).toContain('sm:grid-cols-4')
    expect(grid?.className).not.toContain('flex-1')
    expect(grid?.parentElement?.className).toContain('flex-wrap')
    // Every one of the four is in that grid, and none of them can be squeezed
    // to nothing by a sibling: min-w-0 is on the cell, the floor is the row.
    for (const label of ['Day', 'Room', 'Start', 'Track']) {
      expect(within(form).getByLabelText(label).closest('div.grid')).toBe(grid)
    }
  })

  it('applies the placement optimistically and rolls it back when the save fails', async () => {
    const user = userEvent.setup()
    await mountPage('ready')
    const form = await placementForm(UNPLACED.title)
    await user.selectOptions(within(form).getByLabelText('Room'), ROOM_MAIN.id)

    const pending: { fail: (() => void) | null } = { fail: null }
    fetchHandler = (request) => {
      if (request.method !== 'PUT') return jsonResponse(BOARD)
      return new Promise<Response>((resolvePut) => {
        pending.fail = () =>
          resolvePut(jsonResponse({ error: { code: 'conflict', message: 'raw' } }, 409))
      })
    }
    await user.click(within(form).getByRole('button', { name: /place/i }))

    const pendingButton = await within(form).findByRole('button', { name: 'Placing…' })
    // Pending is not `disabled`: the control stays focusable and keeps its tab
    // stop while it is busy, so the aria-busy it carries is on an element a
    // reader can still be standing on. And nothing wraps it in a live region —
    // a region around a control announces the control's own label as a status,
    // which is how this page came to speak the bare word "Place".
    expect(pendingButton).toHaveAttribute('aria-busy', 'true')
    expect(pendingButton).toHaveAttribute('aria-disabled', 'true')
    expect(pendingButton).not.toHaveAttribute('disabled')
    expect(pendingButton.closest('[aria-live]')).toBeNull()

    // Optimistic: the session shows its new room before the server answers.
    const placedText = new RegExp(`placed in ${ROOM_MAIN.label}`, 'i')
    expect(await within(form).findByText(placedText)).toBeInTheDocument()

    await waitFor(() => expect(pending.fail).not.toBeNull())
    pending.fail?.()

    // The region is mounted from the start (it has to be, to be announced at
    // all), so the wait is for the sentence arriving in it, not for it to exist.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not place the session/i),
    )
    await waitFor(() => expect(within(form).queryByText(placedText)).toBeNull())
    expect(within(form).getByText(/not placed yet/i)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('raw')
  })

  // V3-N3: the in-flight flag was page-wide, so one placement marked EVERY
  // Place button on the board busy — and so did a removal, which places nothing.
  it('marks only the row being placed, leaving every other Place button idle', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(TWO_UNPLACED_BOARD)
    await renderPage()

    const first = await placementForm(UNPLACED.title)
    const second = await placementForm(SECOND_UNPLACED.title)
    await user.selectOptions(within(first).getByLabelText('Room'), ROOM_MAIN.id)

    fetchHandler = (request) => {
      if (request.method !== 'PUT') return jsonResponse(TWO_UNPLACED_BOARD)
      return new Promise<Response>(() => undefined)
    }
    await user.click(within(first).getByRole('button', { name: /^place$/i }))

    expect(await within(first).findByRole('button', { name: 'Placing…' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    const idle = within(second).getByRole('button', { name: /^place$/i })
    expect(idle).not.toHaveAttribute('aria-busy')
    expect(within(second).queryByRole('button', { name: 'Placing…' })).toBeNull()
  })

  it('never claims a session is being placed while another one is being removed', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(MIXED_BOARD)
    await renderPage()

    const unplacedForm = await placementForm(SECOND_UNPLACED.title)
    // Captured before the ask opens: the confirmation is modal, so everything
    // behind it is aria-hidden while the removal runs and the node itself is
    // what can still be read.
    const place = within(unplacedForm).getByRole('button', { name: /^place$/i })
    fetchHandler = (request) => {
      if (request.method !== 'DELETE') return jsonResponse(MIXED_BOARD)
      return new Promise<Response>(() => undefined)
    }
    await user.click(
      screen.getByRole('button', { name: `Remove ${PLACED.title} from the schedule` }),
    )
    await confirmIn(user, 'Remove from the schedule')
    await waitFor(() => expect(requests.some((request) => request.method === 'DELETE')).toBe(true))

    expect(place).not.toHaveAttribute('aria-busy')
    expect(place).toHaveTextContent(/^Place$/)
  })

  it('resyncs its controls to the placement the server actually stored', async () => {
    const user = userEvent.setup()
    await mountPage('ready')
    const form = await placementForm(UNPLACED.title)

    await user.selectOptions(within(form).getByLabelText('Room'), ROOM_WORKSHOP.id)
    // The board has a second write path (the drag board), so the answer to a
    // placement is the board as it now stands, not an echo of what was sent.
    fetchHandler = () => jsonResponse(PLACED_BOARD)
    await user.click(within(form).getByRole('button', { name: /place/i }))

    await waitFor(() => {
      expect(within(form).getByLabelText('Room')).toHaveValue(ROOM_MAIN.id)
    })
    expect(within(form).getByLabelText('Start')).toHaveValue('09:00')
    expect(within(form).getByLabelText('Track')).toHaveValue(TRACK_TALKS.id)
    expect(within(form).getByText(new RegExp(`placed in ${ROOM_MAIN.label}`, 'i'))).toBeVisible()
  })

  it('never reverts a stored placement when it is used again for another field', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()
    const form = await placementForm(PLACED.title)

    // The stored placement moved to Workshop A at 08:00 under this form.
    const moved: AgendaBoardDto = {
      ...PLACED_BOARD,
      sessions: [
        {
          ...PLACED,
          start: '2026-05-13T08:00:00.000Z',
          end: '2026-05-13T09:00:00.000Z',
          roomId: ROOM_WORKSHOP.id,
          roomLabel: ROOM_WORKSHOP.label,
        },
      ],
    }
    fetchHandler = () => jsonResponse(moved)
    await user.click(within(form).getByRole('button', { name: /place/i }))
    await waitFor(() => {
      expect(within(form).getByLabelText('Room')).toHaveValue(ROOM_WORKSHOP.id)
    })

    await user.selectOptions(within(form).getByLabelText('Track'), '')
    await user.click(within(form).getByRole('button', { name: /place/i }))

    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(2)
    })
    expect(requests.filter((request) => request.method === 'PUT')[1]?.body).toEqual({
      day: '2026-05-13',
      roomId: ROOM_WORKSHOP.id,
      trackId: null,
      start: '2026-05-13T08:00:00.000Z',
      end: '2026-05-13T09:00:00.000Z',
    })
  })

  // The Day and Start controls can only offer what the board carries, so a
  // stored placement the window has moved past cannot be shown in them. They
  // then show NOTHING chosen rather than some other slot: a Day and Start
  // quietly holding values the organizer never picked turn an unrelated edit —
  // a track change, say — into a move of the session they never asked for.
  it('names the placement its controls cannot show when the stored day is off the grid', async () => {
    fetchHandler = boardHandler(OFF_GRID_DAY_BOARD)
    await renderPage()
    const form = await placementForm(OFF_GRID_DAY_PLACED.title)

    // The summary keeps reporting where the session actually is.
    expect(
      within(form).getByText(/placed in main hall — 2026-05-15 16:00–17:00 utc/i),
    ).toBeVisible()
    const notice = within(form).getByText(/no longer offers 2026-05-15 16:00/i)
    expect(notice).toHaveAttribute('role', 'status')
    // It names what the controls hold and what has to happen before the
    // session can move at all.
    expect(notice).toHaveTextContent(/day and start below have nothing chosen/i)
    expect(notice).toHaveTextContent(/choose a day and a start time/i)
    expect(notice).toHaveTextContent(/removing it from the schedule takes it off/i)
    // And the controls really are empty, so nothing the organizer did not pick
    // can be submitted.
    expect(within(form).getByLabelText('Day')).toHaveValue('')
    expect(within(form).getByLabelText('Start')).toHaveValue('')
  })

  // The reviewer's reproduction: a session stored at 2026-05-15 16:00 on a grid
  // that stops at 2026-05-14, with only the Track touched, used to be written
  // back as 2026-05-13 08:00 — two days earlier and eight hours back, with no
  // Day or Start interaction at all. A placement only ever moves where the
  // organizer says it moves.
  it('refuses to move an off-grid placement until a day and a start are chosen', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(OFF_GRID_DAY_BOARD)
    await renderPage()
    const form = await placementForm(OFF_GRID_DAY_PLACED.title)

    // The organizer touches only the Track.
    await user.selectOptions(within(form).getByLabelText('Track'), '')
    await user.click(within(form).getByRole('button', { name: /^place$/i }))

    expect(within(form).getByRole('alert')).toHaveTextContent(/choose a day and a start time/i)
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)

    // Naming both is what lets it through, and it goes exactly where they said.
    await user.selectOptions(within(form).getByLabelText('Day'), '2026-05-14')
    await user.selectOptions(within(form).getByLabelText('Start'), '09:00')
    fetchHandler = () => jsonResponse(PLACED_BOARD)
    await user.click(within(form).getByRole('button', { name: /^place$/i }))

    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1)
    })
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
      day: '2026-05-14',
      roomId: ROOM_MAIN.id,
      trackId: null,
      start: '2026-05-14T09:00:00.000Z',
      end: '2026-05-14T10:00:00.000Z',
    })
  })

  it('names it when the day survives but the time of day is no longer a slot of it', async () => {
    fetchHandler = boardHandler(OFF_GRID_TIME_BOARD)
    await renderPage()
    const form = await placementForm(OFF_GRID_TIME_PLACED.title)

    // The day is one the board draws, so all that can be said about it is what
    // the board knows: no slot it draws that day is the one the session holds.
    expect(within(form).queryByText(/no longer offers/i)).toBeNull()
    expect(
      within(form).getByText(/2026-05-13 15:00–16:00, which is not one of the 60-minute slots/i),
    ).toHaveAttribute('role', 'status')
    expect(within(form).getByLabelText('Day')).toHaveValue('')
    expect(within(form).getByLabelText('Start')).toHaveValue('')
  })

  // The end of a placement is as much a part of it as the start. A session
  // stored 09:00–10:30 on a board that offers hour-long slots starts at a time
  // the board does offer, so nothing looked wrong — and a track-only edit
  // silently shortened the session by half an hour.
  it('names a placement whose length no slot of its day expresses, and refuses to shorten it', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(OFF_GRID_END_BOARD)
    await renderPage()
    const form = await placementForm(OFF_GRID_END_PLACED.title)

    expect(within(form).queryByText(/no longer offers/i)).toBeNull()
    expect(
      within(form).getByText(/2026-05-13 09:00–10:30, which is not one of the 60-minute slots/i),
    ).toHaveAttribute('role', 'status')
    expect(within(form).getByLabelText('Day')).toHaveValue('')
    expect(within(form).getByLabelText('Start')).toHaveValue('')

    await user.selectOptions(within(form).getByLabelText('Track'), '')
    await user.click(within(form).getByRole('button', { name: /^place$/i }))

    expect(within(form).getByRole('alert')).toHaveTextContent(/choose a day and a start time/i)
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
  })

  it('says nothing of the sort when the controls can show the stored placement', async () => {
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()
    const form = await placementForm(PLACED.title)

    expect(within(form).getByLabelText('Day')).toHaveValue('2026-05-13')
    expect(within(form).getByLabelText('Start')).toHaveValue('09:00')
    expect(within(form).queryByText(/no longer offers/i)).toBeNull()
    expect(within(form).queryByText(/not one of the 60-minute slots/i)).toBeNull()
  })

  it('says nothing of the sort for a session that claims no placement at all', async () => {
    fetchHandler = boardHandler(OFF_GRID_UNPLACED_BOARD)
    await renderPage()
    const form = await placementForm(OFF_GRID_UNPLACED.title)

    expect(within(form).getByText(/not placed yet/i)).toBeVisible()
    expect(within(form).queryByText(/no longer offers/i)).toBeNull()
    expect(within(form).queryByText(/not one of the 60-minute slots/i)).toBeNull()
  })

  // Saving the taxonomy re-mints every room and track id, so a placement made
  // before that save points at a room the board no longer carries. The session
  // is still on the schedule — and still on the public programme when it was
  // published — so a page that calls it unplaced tells the organizer the
  // opposite of what an audience will find in front of them.
  it('still reports a placement whose room the taxonomy no longer carries as placed', async () => {
    fetchHandler = boardHandler(ORPHANED_BOARD)
    await renderPage()
    const form = await placementForm(ORPHANED_PLACED.title)

    expect(within(form).queryByText(/not placed yet/i)).toBeNull()
    expect(
      within(form).getByText(
        /placed in a room this event no longer has — 2026-05-13 09:00–10:00 utc/i,
      ),
    ).toBeVisible()
    const notice = within(form).getByText(/no longer one of this event/i)
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(/choose one and place the session again/i)
    expect(notice).toHaveTextContent(/remove it from the schedule/i)
  })

  it('never places a session into a room the Room select could not show', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(ORPHANED_BOARD)
    await renderPage()
    const form = await placementForm(ORPHANED_PLACED.title)

    // No option carries the re-minted ids, so the selects show nothing chosen —
    // and what they show is what the form will send.
    expect(within(form).getByLabelText('Room')).toHaveValue('')
    expect(within(form).getByLabelText('Track')).toHaveValue('')

    await user.click(within(form).getByRole('button', { name: /^place$/i }))
    expect(within(form).getByRole('alert')).toHaveTextContent(/choose a room/i)
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)

    // The control is not a dead one: a room the board really carries places it.
    await user.selectOptions(within(form).getByLabelText('Room'), ROOM_WORKSHOP.id)
    fetchHandler = () => jsonResponse(PLACED_BOARD)
    await user.click(within(form).getByRole('button', { name: /^place$/i }))

    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1)
    })
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
      day: '2026-05-13',
      roomId: ROOM_WORKSHOP.id,
      trackId: null,
      start: '2026-05-13T09:00:00.000Z',
      end: '2026-05-13T10:00:00.000Z',
    })
  })

  it('never offers a removal beside a claim that there is nothing to remove', async () => {
    fetchHandler = boardHandler(ORPHANED_NO_ROOMS_BOARD)
    await renderPage()
    const form = await placementForm(ORPHANED_PLACED.title)

    expect(within(form).queryByText(/not placed yet/i)).toBeNull()
    expect(within(form).getByText(/placed in a room this event no longer has/i)).toBeVisible()
    expect(within(form).getByText(/no longer one of this event/i)).toHaveAttribute('role', 'status')
    expect(within(form).queryByLabelText('Room')).toBeNull()
    expect(
      within(form).getByRole('button', {
        name: new RegExp(`remove ${ORPHANED_PLACED.title} from the schedule`, 'i'),
      }),
    ).toBeInTheDocument()
  })

  it('says nothing of the sort while the board still carries the room it names', async () => {
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()
    const form = await placementForm(PLACED.title)

    expect(within(form).getByText(/placed in main hall/i)).toBeVisible()
    expect(within(form).queryByText(/no longer one of this event/i)).toBeNull()
    expect(within(form).getByLabelText('Room')).toHaveValue(ROOM_MAIN.id)
    expect(within(form).getByLabelText('Track')).toHaveValue(TRACK_TALKS.id)
  })
})

// A notice that explains why a control holds what it holds is part of that
// control: read on its own, an empty Day says nothing, and a screen-reader user
// moving through the form by field never reaches a status region sitting beside
// it. (The live region alone would not carry it either — a role=status that
// mounts already populated is generally not announced at all.)
describe('the notices beside the controls they contradict', () => {
  it('describes Day and Start with the notice that says why they are empty', async () => {
    fetchHandler = boardHandler(OFF_GRID_DAY_BOARD)
    await renderPage()
    const form = await placementForm(OFF_GRID_DAY_PLACED.title)

    expect(within(form).getByLabelText('Day')).toHaveAccessibleDescription(
      /no longer offers 2026-05-15 16:00/i,
    )
    expect(within(form).getByLabelText('Start')).toHaveAccessibleDescription(
      /no longer offers 2026-05-15 16:00/i,
    )
    // The Room select is not the control that notice is about.
    expect(within(form).getByLabelText('Room')).toHaveAccessibleDescription('')
  })

  it('describes Room with the notice that says why it is empty', async () => {
    fetchHandler = boardHandler(ORPHANED_BOARD)
    await renderPage()
    const form = await placementForm(ORPHANED_PLACED.title)

    expect(within(form).getByLabelText('Room')).toHaveAccessibleDescription(
      /no longer one of this event/i,
    )
    expect(within(form).getByLabelText('Day')).toHaveAccessibleDescription('')
  })

  // Every session on the board renders the same form, so a fixed id would be
  // repeated down the page and every Day would point at the first row's notice.
  it('gives each session row a notice of its own', async () => {
    const second: AgendaSessionDto = {
      ...OFF_GRID_DAY_PLACED,
      submissionId: SECOND_PLACED.submissionId,
      title: SECOND_PLACED.title,
    }
    fetchHandler = boardHandler({
      ...OFF_GRID_DAY_BOARD,
      sessions: [OFF_GRID_DAY_PLACED, second],
    })
    await renderPage()

    const first = await placementForm(OFF_GRID_DAY_PLACED.title)
    const other = await placementForm(second.title)
    const describedBy = (form: HTMLElement): string =>
      within(form).getByLabelText('Day').getAttribute('aria-describedby') ?? ''

    expect(describedBy(first)).not.toBe('')
    expect(describedBy(first)).not.toBe(describedBy(other))
    expect(within(first).getByLabelText('Day')).toHaveAccessibleDescription(/no longer offers/i)
    expect(within(other).getByLabelText('Day')).toHaveAccessibleDescription(/no longer offers/i)
  })
})

// The board draws a bounded number of days, so a long window reaches past the
// last day it draws. Those days are not days the window fails to offer — the
// server takes a placement on every one of them — so the board says how much of
// the window it is showing, and never tells an organizer that a day the event
// really covers is one the event no longer has.
describe('a window longer than the board draws', () => {
  it('says how much of the window it is showing', async () => {
    fetchHandler = boardHandler(CAPPED_BOARD)
    await renderPage()

    const notice = await screen.findByText(/showing the first 2 days of this 32-day event window/i)
    expect(notice).toHaveAttribute('role', 'status')
    expect(screen.getByLabelText('Board day')).toHaveAccessibleDescription(
      /showing the first 2 days of this 32-day event window/i,
    )
  })

  it('says nothing of the sort about a window it draws end to end', async () => {
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()
    await placementForm(PLACED.title)

    expect(screen.queryByText(/showing the first/i)).toBeNull()
    expect(screen.getByLabelText('Board day')).toHaveAccessibleDescription('')
  })

  it('never calls a day the window covers one the window no longer offers', async () => {
    fetchHandler = boardHandler(CAPPED_BOARD)
    await renderPage()
    const form = await placementForm(CAPPED_PLACED.title)

    // The event really does offer 2026-05-20 and the server really does accept
    // it; only this board stops short of drawing it.
    expect(within(form).queryByText(/no longer offers/i)).toBeNull()
    const notice = within(form).getByText(
      /past the first 2 days the board shows of this 32-day event window/i,
    )
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(/2026-05-20 09:00–10:00/)
    expect(within(form).getByLabelText('Day')).toHaveAccessibleDescription(
      /past the first 2 days the board shows/i,
    )
  })

  it('never moves a placement off a day it merely stopped short of drawing', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(CAPPED_BOARD)
    await renderPage()
    const form = await placementForm(CAPPED_PLACED.title)

    await user.selectOptions(within(form).getByLabelText('Track'), '')
    await user.click(within(form).getByRole('button', { name: /^place$/i }))

    expect(within(form).getByRole('alert')).toHaveTextContent(/choose a day and a start time/i)
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
  })
})

// The day cap is not the only way a board stops short of its window. Each day
// is drawn in whole slots counted from where that day opens, so an event whose
// start of day moves re-anchors every slot of its first day, and a session
// longer than one slot lines up with none of them — while the server goes on
// accepting both. Those hours are hours the window really covers, so the board
// must never call them hours the window stopped offering. Every board below is
// built by `buildAgendaGrid` from a real window, and every placement is put to
// `isPlaceableSlot`, which is the one rule the server places by.
describe('a placement the window still covers that no slot of the board expresses', () => {
  const asSlot = (session: AgendaSessionDto) => ({
    day: session.day,
    start: session.start,
    end: session.end,
  })
  const boardOver = (dates: EventDates, sessions: readonly AgendaSessionDto[]): AgendaBoardDto => {
    const grid = buildAgendaGrid(dates)
    return { ...PLACED_BOARD, days: grid.days, windowDays: grid.windowDays, sessions }
  }

  // The organizer's own sequence, with no API poking anywhere in it: the event
  // runs 09:00–17:00 across three days, a session is placed at 09:00–10:00
  // through the board, and then "Starts at" moves back to 08:30 in the event
  // settings — which widens the window rather than trimming it. Every slot of
  // the first day is redrawn from 08:30, so 09:00 is no longer one of them.
  const WIDENED_WINDOW: EventDates = {
    startsAt: '2026-05-13T08:30:00.000Z',
    endsAt: '2026-05-15T17:00:00.000Z',
  }

  it('says the board cannot draw the hour, never that the window stopped offering it', async () => {
    // The window still covers the placement, and the server still takes it.
    expect(isPlaceableSlot(WIDENED_WINDOW, asSlot(PLACED))).toBe(true)
    const board = boardOver(WIDENED_WINDOW, [PLACED])
    // No day cap is in play either: the board draws the window end to end.
    expect(board.days).toHaveLength(board.windowDays)

    fetchHandler = boardHandler(board)
    await renderPage()
    const form = await placementForm(PLACED.title)

    expect(within(form).queryByText(/no longer offers/i)).toBeNull()
    const notice = within(form).getByText(/not one of the 60-minute slots this board draws/i)
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(/2026-05-13 09:00–10:00/)
    // And the session has not moved and will not move on its own.
    expect(notice).toHaveTextContent(/stays there until you move it/i)
    expect(within(form).getByLabelText('Day')).toHaveValue('')
    expect(within(form).getByLabelText('Start')).toHaveValue('')
  })

  // The same falsehood reached through the length alone: an ordinary
  // 08:00–17:00 window covers a ninety-minute session end to end, and no slot
  // of an hour-long lattice is ninety minutes.
  const ORDINARY_WINDOW: EventDates = {
    startsAt: '2026-05-13T08:00:00.000Z',
    endsAt: '2026-05-15T17:00:00.000Z',
  }
  const NINETY_MINUTE_PLACED: AgendaSessionDto = {
    ...PLACED,
    start: '2026-05-13T09:00:00.000Z',
    end: '2026-05-13T10:30:00.000Z',
  }

  it('says the same of a session longer than any slot the board draws', async () => {
    expect(isPlaceableSlot(ORDINARY_WINDOW, asSlot(NINETY_MINUTE_PLACED))).toBe(true)

    fetchHandler = boardHandler(boardOver(ORDINARY_WINDOW, [NINETY_MINUTE_PLACED]))
    await renderPage()
    const form = await placementForm(NINETY_MINUTE_PLACED.title)

    expect(within(form).queryByText(/no longer offers/i)).toBeNull()
    expect(
      within(form).getByText(/not one of the 60-minute slots this board draws/i),
    ).toHaveTextContent(/2026-05-13 09:00–10:30/)
  })

  // And the sentence is not gone, only held to the case it is true of: a window
  // trimmed past the day the session sits on really has stopped offering it,
  // and the server refuses that placement now.
  it('still says the window moved past a placement the window really moved past', async () => {
    const TRIMMED_WINDOW: EventDates = {
      startsAt: '2026-05-13T09:00:00.000Z',
      endsAt: '2026-05-14T17:00:00.000Z',
    }
    expect(isPlaceableSlot(TRIMMED_WINDOW, asSlot(OFF_GRID_DAY_PLACED))).toBe(false)

    fetchHandler = boardHandler(boardOver(TRIMMED_WINDOW, [OFF_GRID_DAY_PLACED]))
    await renderPage()
    const form = await placementForm(OFF_GRID_DAY_PLACED.title)

    expect(
      within(form).getByText(/the event window no longer offers 2026-05-15 16:00–17:00/i),
    ).toHaveAttribute('role', 'status')
    expect(within(form).getByLabelText('Day')).toHaveValue('')
    expect(within(form).getByLabelText('Start')).toHaveValue('')
  })
})

// The board is the other write path, and it takes a drop the organizer never
// made. dnd-kit's pointer sensor starts a drag on pointerdown with no distance
// to clear first, so one click on a chip is a whole drag cycle: the chip never
// leaves the cell it is drawn in, and the drop lands on that same cell. A cell
// stands for its own slot, not for the placement the session holds — and a cell
// shows a session by its start alone. So a session stored 09:00–10:30 is drawn
// in the 09:00–10:00 cell beside the form that says the board cannot draw those
// hours, and re-deriving a placement from that cell writes it back half an hour
// shorter; a session whose track the taxonomy has re-minted is written back
// with no track at all. Neither click asks for a move, so neither writes one.
describe('a click that moves a session nowhere', () => {
  const WINDOW: EventDates = {
    startsAt: '2026-05-13T08:00:00.000Z',
    endsAt: '2026-05-13T17:00:00.000Z',
  }

  const boardOver = (sessions: readonly AgendaSessionDto[]): AgendaBoardDto => {
    const grid = buildAgendaGrid(WINDOW)
    return { ...PLACED_BOARD, days: grid.days, windowDays: grid.windowDays, sessions }
  }

  const NINETY_MINUTE_PLACED: AgendaSessionDto = {
    ...PLACED,
    status: 'published',
    end: '2026-05-13T10:30:00.000Z',
  }

  const REMINTED_TRACK_PLACED: AgendaSessionDto = {
    ...PLACED,
    status: 'published',
    trackId: REMINTED_TRACK_ID,
    trackLabel: null,
  }

  function stubRect(element: Element, x: number, y: number, width: number, height: number): void {
    element.getBoundingClientRect = () => ({
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({ x, y, width, height }),
    })
  }

  /**
   * The ordinary geometry jsdom gives no element: every cell of the table a
   * 200×100 box in its own row and column, and every chip a smaller box inside
   * the cell that holds it. Collision detection needs nothing else.
   */
  function stubBoardGeometry(rooms: number): void {
    Array.from(document.querySelectorAll('td')).forEach((cell, index) => {
      const left = (index % rooms) * 200
      const top = Math.floor(index / rooms) * 100
      stubRect(cell, left, top, 200, 100)
      const chip = cell.querySelector('[role="button"]')
      if (chip !== null) stubRect(chip, left + 10, top + 10, 100, 40)
    })
  }

  /** The chip of one session, in the cell the board draws it in. */
  async function chipIn(cellLabel: string, title: string): Promise<HTMLElement> {
    const cell = await screen.findByLabelText(cellLabel)
    stubBoardGeometry(PLACED_BOARD.rooms.length)
    return within(cell).getByRole('button', { name: title })
  }

  it('never shortens a placement the board cannot draw in whole', async () => {
    const user = userEvent.setup()
    // The window covers the placement end to end and the server still takes it:
    // nothing about this session needs moving.
    expect(
      isPlaceableSlot(WINDOW, {
        day: NINETY_MINUTE_PLACED.day,
        start: NINETY_MINUTE_PLACED.start,
        end: NINETY_MINUTE_PLACED.end,
      }),
    ).toBe(true)
    fetchHandler = boardHandler(boardOver([NINETY_MINUTE_PLACED]))
    await renderPage()
    const form = await placementForm(NINETY_MINUTE_PLACED.title)
    expect(
      within(form).getByText(/not one of the 60-minute slots this board draws/i),
    ).toHaveTextContent(/2026-05-13 09:00–10:30/)

    await user.click(await chipIn('Main hall at 09:00', NINETY_MINUTE_PLACED.title))

    // A click on a chip is a whole drag cycle, so the board has run one.
    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('Scaling Postgres was dropped')
    })
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
    // And it is told as what it was, not as a placement that never happened.
    expect(document.body.textContent ?? '').toContain(
      'was dropped back into Main hall on 2026-05-13 at 09:00 and kept its place.',
    )
    expect(within(form).getByText(/placed in Main hall/i)).toHaveTextContent(/09:00–10:30/)
    expect(document.body.textContent ?? '').not.toMatch(/placed scaling postgres in main hall/i)
  })

  it('never drops the track of a session whose taxonomy ids were re-minted', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(boardOver([REMINTED_TRACK_PLACED]))
    await renderPage()
    const form = await placementForm(REMINTED_TRACK_PLACED.title)

    await user.click(await chipIn('Main hall at 09:00', REMINTED_TRACK_PLACED.title))

    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('Scaling Postgres was dropped')
    })
    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
    expect(within(form).getByText(/placed in Main hall/i)).toBeInTheDocument()
  })

  it('still places a session dragged into another cell', async () => {
    const user = userEvent.setup()
    const board = boardOver([PLACED])
    fetchHandler = boardHandler(board)
    await renderPage()
    await placementForm(PLACED.title)
    const chip = await chipIn('Main hall at 09:00', PLACED.title)

    // Main hall is the first column and Workshop A the second, so the chip
    // crosses one column width into the cell beside it.
    await user.pointer([
      { keys: '[MouseLeft>]', target: chip, coords: { clientX: 60, clientY: 130 } },
      { target: chip, coords: { clientX: 260, clientY: 130 } },
      { keys: '[/MouseLeft]' },
    ])

    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1)
    })
    expect(requests.find((request) => request.method === 'PUT')?.body).toEqual({
      day: '2026-05-13',
      roomId: ROOM_WORKSHOP.id,
      trackId: TRACK_TALKS.id,
      start: '2026-05-13T09:00:00.000Z',
      end: '2026-05-13T10:00:00.000Z',
    })
  })
})

describe('agenda preconditions', () => {
  const EVENT_SETTINGS_PATH = `/admin/events/${EVENT_SLUG}`
  const TAXONOMIES_PATH = `/admin/events/${EVENT_SLUG}/taxonomies`

  it('names the missing event dates and links to where they are set', async () => {
    await mountPage('undated')

    const notice = await screen.findByText(/no dates yet/i)
    expect(notice).toHaveAttribute('role', 'status')
    // Named by its own sentence, not by the destination: the rail beside the
    // page also links to the event settings, and the link that matters here is
    // the one the prerequisite offers.
    expect(
      screen.getByRole('link', { name: /set the event dates in the event settings/i }),
    ).toHaveAttribute('href', EVENT_SETTINGS_PATH)
    // A prerequisite that is already met is never printed as missing.
    expect(document.body.textContent ?? '').not.toMatch(/no rooms/i)
    expect(document.body.textContent ?? '').not.toMatch(/schedulable|too short/i)
    expect(await placementForm(UNPLACED.title)).toBeInTheDocument()
  })

  it('names the unschedulable window instead of dates that are already set', async () => {
    await mountPage('no-time')

    const notice = await screen.findByText(/too short to hold/i)
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(/60-minute/i)
    // The dates ARE configured here: telling the organizer to set them would
    // send them to a field they have already filled in.
    expect(document.body.textContent ?? '').not.toMatch(/no dates yet/i)
    expect(document.body.textContent ?? '').not.toMatch(/no rooms/i)
    expect(
      screen.getByRole('link', { name: /widen the event window in the event settings/i }),
    ).toHaveAttribute('href', EVENT_SETTINGS_PATH)
  })

  it('names the missing rooms and links to the taxonomy editor', async () => {
    await mountPage('no-rooms')

    const notice = await screen.findByText(/no rooms/i)
    expect(notice).toHaveAttribute('role', 'status')
    expect(screen.getByRole('link', { name: /taxonomy editor/i })).toHaveAttribute(
      'href',
      TAXONOMIES_PATH,
    )
    expect(document.body.textContent ?? '').not.toMatch(/no dates yet/i)
    expect(document.body.textContent ?? '').not.toMatch(/too short to hold/i)
  })

  it('names every prerequisite that is missing, not just the first', async () => {
    fetchHandler = boardHandler({ ...BOARD, days: [], windowDays: 0, rooms: [] })
    await renderPage()

    expect(await screen.findByText(/no dates yet/i)).toBeInTheDocument()
    expect(screen.getByText(/no rooms/i)).toBeInTheDocument()
  })

  it.each(['undated', 'no-time', 'no-rooms'] as const)(
    'offers no placement control that could not work in the %s state',
    async (state) => {
      await mountPage(state)
      const form = await placementForm(UNPLACED.title)

      expect(within(form).queryByLabelText('Day')).toBeNull()
      expect(within(form).queryByLabelText('Room')).toBeNull()
      expect(within(form).queryByLabelText('Start')).toBeNull()
      expect(within(form).queryByLabelText('Track')).toBeNull()
      expect(within(form).queryByRole('button', { name: /^place$/i })).toBeNull()
      expect(screen.queryByRole('region', { name: /placement board/i })).toBeNull()
      expect(screen.queryByLabelText('Board day')).toBeNull()
      // No drop target can exist without a cell, so the board that would hold
      // them is not rendered at all — and nothing writes a placement.
      expect(document.querySelectorAll('td')).toHaveLength(0)
      expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(0)
    },
  )

  it.each([
    ['undated', UNDATED_PLACED_BOARD, UNDATED_BOARD],
    ['no-rooms', NO_ROOMS_PLACED_BOARD, NO_ROOMS_BOARD],
  ] as const)(
    'still lets the organizer unwind a placement it cannot recreate (%s)',
    async (_state, placedBoard, emptyBoard) => {
      const user = userEvent.setup()
      fetchHandler = boardHandler(placedBoard)
      await renderPage()
      const form = await placementForm(PLACED.title)

      expect(
        within(form).getByText(new RegExp(`placed in ${ROOM_MAIN.label}`, 'i')),
      ).toBeInTheDocument()
      fetchHandler = () => jsonResponse(emptyBoard)
      await user.click(
        within(form).getByRole('button', {
          name: new RegExp(`remove ${PLACED.title} from the schedule`, 'i'),
        }),
      )
      await confirmIn(user, 'Remove from the schedule')

      await waitFor(() => {
        expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
      })
      expect(await within(form).findByText(/not placed yet/i)).toBeInTheDocument()
    },
  )

  it('reports conflicts without a reschedule shortcut that has nowhere to go', async () => {
    fetchHandler = boardHandler(UNDATED_CONFLICT_BOARD)
    await renderPage()

    const conflicts = await screen.findByRole('region', { name: /conflicts/i })
    expect(within(conflicts).getByText(new RegExp(PLACED.title, 'i'))).toBeInTheDocument()
    expect(within(conflicts).queryByRole('button', { name: /reschedule/i })).toBeNull()
  })

  it('says nothing about a prerequisite once the board can take a placement', async () => {
    await mountPage('ready')
    await placementForm(UNPLACED.title)

    expect(document.body.textContent ?? '').not.toMatch(/no dates yet|no rooms|too short to hold/i)
  })
})

describe('agenda retraction', () => {
  it('takes a placed session off the schedule through the API', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()
    const form = await placementForm(PLACED.title)

    fetchHandler = () => jsonResponse(BOARD)
    await user.click(
      within(form).getByRole('button', {
        name: new RegExp(`remove ${PLACED.title} from the schedule`, 'i'),
      }),
    )
    // The dialog names what disappears before the removal runs, and Cancel is
    // what it opens focused on.
    const removalDialog = await screen.findByRole('dialog')
    expect(removalDialog).toHaveTextContent(new RegExp(PLACED.title, 'i'))
    await waitFor(() =>
      expect(within(removalDialog).getByRole('button', { name: 'Cancel' })).toHaveFocus(),
    )
    await confirmIn(user, 'Remove from the schedule')

    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
    })
    expect(requests.find((request) => request.method === 'DELETE')?.url).toBe(
      `${AGENDA_URL}/${PLACED.submissionId}`,
    )
    expect(await within(form).findByText(/not placed yet/i)).toBeInTheDocument()
    expect(await screen.findByText(/removed .* from the schedule/i)).toBeInTheDocument()
  })

  it('writes nothing when the removal is asked for and then declined', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()
    const form = await placementForm(PLACED.title)

    await user.click(
      within(form).getByRole('button', {
        name: new RegExp(`remove ${PLACED.title} from the schedule`, 'i'),
      }),
    )
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(0)
    expect(within(form).getByText(new RegExp(`placed in ${ROOM_MAIN.label}`, 'i'))).toBeVisible()
  })

  it('offers no removal for a session that has no place yet', async () => {
    await mountPage('ready')
    const form = await placementForm(UNPLACED.title)

    expect(within(form).queryByRole('button', { name: /remove/i })).toBeNull()
  })

  it('reports a failed removal without leaking server copy', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()
    const form = await placementForm(PLACED.title)

    fetchHandler = (request) =>
      request.method === 'DELETE'
        ? jsonResponse({ error: { code: 'conflict', message: 'raw server copy' } }, 409)
        : jsonResponse(PLACED_BOARD)
    await user.click(
      within(form).getByRole('button', {
        name: new RegExp(`remove ${PLACED.title} from the schedule`, 'i'),
      }),
    )
    await confirmIn(user, 'Remove from the schedule')

    // The dialog stays open over the failure, so this also pins that the page's
    // one alert region survives inside the subtree the modal hides — a region
    // created at that moment would not have (F-R3-11).
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not remove the session/i),
    )
    expect(await screen.findByRole('dialog')).toHaveTextContent(/the last attempt failed/i)
    expect(document.body.textContent ?? '').not.toContain('raw server copy')
  })
})

describe('agenda publishing, conflicts and views', () => {
  it('publishes through the API and reports what it published', async () => {
    const user = userEvent.setup()
    fetchHandler = (request) => {
      if (request.method === 'POST' && request.url === PUBLISH_URL) {
        return jsonResponse({
          publishedCount: 1,
          board: {
            ...PLACED_BOARD,
            sessions: [{ ...PLACED, status: 'published' }],
          },
        })
      }
      return jsonResponse(PLACED_BOARD)
    }
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /publish agenda/i }))
    // Publishing puts the schedule in front of an audience, so the ask names
    // how many sessions that is before anything is written.
    expect(await screen.findByRole('dialog')).toHaveTextContent(/1 scheduled session/i)
    await confirmIn(user, 'Publish to the programme')

    await waitFor(() => {
      expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    })
    expect(requests.find((request) => request.method === 'POST')?.url).toBe(PUBLISH_URL)
    expect(await screen.findByText(/published 1 session/i)).toBeInTheDocument()
  })

  // TA5-P1/P12: draft-or-published is a lifecycle state, so the chip carries a
  // marker that survives greyscale — and while a publish that really moves
  // THIS session is in the air, that marker is what says so. The chip used to
  // claim the old state as calmly as ever while the button beside it went
  // pending.
  it('breathes the chip of a session a publish is really moving, and no other', async () => {
    const user = userEvent.setup()
    let releasePublish: ((response: Response) => void) | undefined
    // The board the server would answer with, so the refetch that follows a
    // publish agrees with the publish itself.
    let served: AgendaBoardDto = PART_PUBLISHED_CONFLICT_BOARD
    fetchHandler = (request) => {
      if (request.method === 'POST' && request.url === PUBLISH_URL) {
        return new Promise<Response>((resolve) => {
          releasePublish = resolve
        })
      }
      return jsonResponse(served)
    }
    await renderPage()

    // Queried through the DOM rather than by role: the confirm dialog holds
    // the rest of the page inert while it is open, which is exactly the moment
    // this contract is about.
    const chipOf = (title: string): Element | null =>
      document.querySelector(`form[aria-label="Placement for ${title}"] [data-slot="badge"]`)

    await placementForm(PLACED.title)
    expect(chipOf(PLACED.title)).toHaveAttribute('data-dot', '')
    expect(chipOf(PLACED.title)).not.toHaveAttribute('data-pending')

    await user.click(await screen.findByRole('button', { name: /publish agenda/i }))
    await confirmIn(user, 'Publish to the programme')

    await waitFor(() => expect(chipOf(PLACED.title)).toHaveAttribute('data-pending', ''))
    // The word does not change while the wait lasts: it is still the last
    // state the server confirmed.
    expect(chipOf(PLACED.title)).toHaveTextContent('Draft')
    // Visual only. The wait is already spoken by the region this page owns,
    // and this product allows exactly one of those.
    expect(chipOf(PLACED.title)).not.toHaveAttribute('aria-live')
    expect(chipOf(PLACED.title)).not.toHaveAttribute('role')
    // A session already on the programme is not waiting on this press.
    expect(chipOf(SECOND_PLACED.title)).not.toHaveAttribute('data-pending')
    expect(chipOf(SECOND_PLACED.title)).toHaveAttribute('data-dot', '')

    served = {
      ...PART_PUBLISHED_CONFLICT_BOARD,
      sessions: [
        { ...PLACED, status: 'published' },
        { ...SECOND_PLACED, status: 'published' },
      ],
    }
    releasePublish?.(jsonResponse({ publishedCount: 1, board: served }))
    await waitFor(() => expect(chipOf(PLACED.title)).toHaveTextContent('Published'))
    expect(chipOf(PLACED.title)).not.toHaveAttribute('data-pending')
  })

  it('renders each conflict with both session titles and moves focus to the fix', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(CONFLICT_BOARD)
    await renderPage()

    const conflicts = await screen.findByRole('region', { name: /conflicts/i })
    expect(within(conflicts).getByText(/room/i)).toBeInTheDocument()
    expect(within(conflicts).getByText(new RegExp(PLACED.title, 'i'))).toBeInTheDocument()
    expect(within(conflicts).getByText(new RegExp(SECOND_PLACED.title, 'i'))).toBeInTheDocument()

    await user.click(within(conflicts).getByRole('button', { name: new RegExp(PLACED.title, 'i') }))
    const form = await placementForm(PLACED.title)
    expect(within(form).getByLabelText('Day')).toHaveFocus()
  })

  it('announces the placement that landed and the conflict it created', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(ABOUT_TO_CLASH_BOARD)
    await renderPage()

    const conflicts = await screen.findByRole('region', { name: /conflicts/i })
    expect(within(conflicts).getByRole('status')).toHaveTextContent(/no conflicts/i)

    const form = await placementForm(SECOND_UNPLACED.title)
    await user.selectOptions(within(form).getByLabelText('Room'), ROOM_MAIN.id)
    await user.selectOptions(within(form).getByLabelText('Start'), '09:00')
    fetchHandler = () => jsonResponse(CONFLICT_BOARD)
    await user.click(within(form).getByRole('button', { name: /place/i }))

    const sessions = await screen.findByRole('region', { name: 'Sessions' })
    expect(await within(sessions).findByRole('status')).toHaveTextContent(
      new RegExp(`placed ${SECOND_UNPLACED.title}`, 'i'),
    )
    // The live region survives the empty-to-non-empty transition, so the
    // organizer hears the double booking instead of only seeing it.
    await waitFor(() => {
      expect(within(conflicts).getByRole('status')).toHaveTextContent(/1 conflict/i)
    })
  })

  it('renders the five organizer views over the same schedule', async () => {
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()

    for (const name of ['List', 'Day', 'Week', 'Track', 'Room']) {
      const view = await screen.findByRole('region', { name: `${name} view` })
      expect(within(view).getByText(PLACED.title)).toBeInTheDocument()
    }
    expect(
      within(await screen.findByRole('region', { name: 'Week view' })).getByText('2026-W20'),
    ).toBeInTheDocument()
  })

  it('gives an untracked session its own named group instead of the previous track’s', async () => {
    fetchHandler = boardHandler(UNTRACKED_BOARD)
    await renderPage()

    const view = await screen.findByRole('region', { name: 'Track view' })
    // The group the untracked session sits in is the one that says so — the
    // heading is inside its own list item, so a reader moving through the tree
    // meets "No track" before the session and never "Talks".
    const group = within(view)
      .getByText(UNTRACKED.title)
      .closest('li')
      ?.parentElement?.closest('li')
    expect(group).not.toBeNull()
    expect(group).toHaveTextContent('No track')
    expect(group).not.toHaveTextContent(TRACK_TALKS.label)
    // And the real track keeps only its own session.
    const talks = within(view).getByText(TRACK_TALKS.label).closest('li')
    expect(talks).toHaveTextContent(PLACED.title)
    expect(talks).not.toHaveTextContent(UNTRACKED.title)
    // The word is the one the placement select offers for the same state.
    expect(within(await placementForm(UNTRACKED.title)).getByLabelText('Track')).toHaveTextContent(
      'No track',
    )
  })

  it('names the sessions a publish really moves, and the conflict it would take public', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(PART_PUBLISHED_CONFLICT_BOARD)
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /publish agenda/i }))
    const dialog = await screen.findByRole('dialog')

    // Two sessions are scheduled and one of them is already on the programme,
    // so this press moves exactly one — the number the outcome will report.
    expect(dialog).toHaveTextContent(/1 scheduled session/i)
    expect(dialog).not.toHaveTextContent(/2 scheduled sessions/i)
    // The double booking the board shows is named in the ask, not hidden by it.
    expect(dialog).toHaveTextContent(/one unresolved room conflict/i)
    // And the way back is stated truthfully: removal is a control on this page.
    expect(dialog).toHaveTextContent(/removed from the schedule/i)
  })

  // V3-N1: "publishes nothing" has two entirely different causes, and one
  // sentence was doing both jobs — telling an organizer who has scheduled
  // nothing at all that everything scheduled is already public.
  it('says nothing is scheduled yet rather than that everything is already public', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(BOARD)
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /publish agenda/i }))
    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveTextContent(/no sessions are scheduled yet/i)
    expect(dialog).not.toHaveTextContent(/already on the public programme/i)
  })

  it('says everything is already public when every scheduled session is', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler({
      ...PLACED_BOARD,
      sessions: [{ ...PLACED, status: 'published' }],
    })
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /publish agenda/i }))
    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveTextContent(/already on the public programme/i)
    expect(dialog).not.toHaveTextContent(/no sessions are scheduled yet/i)
  })

  it('says nothing about conflicts when the board has none', async () => {
    const user = userEvent.setup()
    fetchHandler = boardHandler(PLACED_BOARD)
    await renderPage()

    await user.click(await screen.findByRole('button', { name: /publish agenda/i }))
    const dialog = await screen.findByRole('dialog')

    expect(dialog).toHaveTextContent(/1 scheduled session/i)
    expect(dialog).not.toHaveTextContent(/unresolved/i)
  })
})

describe('agenda admin purity', () => {
  it('keeps no control that only moves local state', async () => {
    await mountPage('ready')
    await placementForm(UNPLACED.title)

    expect(screen.queryByRole('button', { name: /toggle status/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^move/i })).toBeNull()
  })

  it('reaches dnd-kit only through the dynamic board import', () => {
    const importers = readdirSync(ADMIN_FEATURE_DIR)
      .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
      .filter((file) => readFileSync(join(ADMIN_FEATURE_DIR, file), 'utf8').includes('@dnd-kit'))

    expect(importers).toEqual(['AgendaDndBoard.tsx'])
    expect(readFileSync(join(ADMIN_FEATURE_DIR, 'AgendaAdminPage.tsx'), 'utf8')).toContain(
      "import('./AgendaDndBoard')",
    )
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
