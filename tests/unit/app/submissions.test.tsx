import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FormVersionDetailDto,
  SubmissionDetailDto,
  SubmissionListItemDto,
} from '../../../src/application'
import SubmissionDetail from '../../../src/app/features/admin/SubmissionDetail'
import SubmissionList from '../../../src/app/features/admin/SubmissionList'
import { createQueryClient } from '../../../src/app/query-client'

const EVENT_SLUG = 'demo-conf-2026'
const SUBMISSION_ID = 'submission-1'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'

const SUBMISSION_LIST_ITEM: SubmissionListItemDto = {
  id: SUBMISSION_ID,
  title: 'My talk',
  status: 'pending',
  formId: FORM_ID,
  formSlug: 'cfp',
  version: 1,
  routing: null,
  primarySpeaker: {
    contactId: 'contact-1',
    name: 'Speaker A',
    email: 'speaker.a@example.test',
    role: 'primary',
    position: 0,
  },
  coSpeakerCount: 0,
  decision: 'pending',
  createdAt: '2026-08-08T12:00:00.000Z',
  submittedAt: '2026-08-08T12:00:00.000Z',
}

const SUBMISSION_DETAIL: SubmissionDetailDto = {
  id: SUBMISSION_ID,
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  formId: FORM_ID,
  formSlug: 'cfp',
  versionId: VERSION_ID,
  version: 1,
  status: 'pending',
  title: 'My talk',
  answers: { title: 'My talk', format: 'talk' },
  routing: null,
  contributors: [
    {
      contactId: 'contact-1',
      name: 'Speaker A',
      email: 'speaker.a@example.test',
      role: 'primary',
      position: 0,
    },
  ],
  createdAt: '2026-08-08T12:00:00.000Z',
  submittedAt: '2026-08-08T12:00:00.000Z',
  editable: true,
  contentStatus: 'approved',
}

const FORM_VERSION_DETAIL: FormVersionDetailDto = {
  formId: FORM_ID,
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  versionId: VERSION_ID,
  version: 1,
  status: 'draft',
  contentHash: null,
  publishedAt: null,
  updatedAt: '2026-08-08T09:00:00.000Z',
  pages: [{ id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: '' }],
  elements: [
    {
      id: 'e-1',
      pageId: 'p-1',
      position: 0,
      kind: 'question',
      fieldKey: 'title',
      label: 'Title',
      required: true,
      maxLength: 120,
      questionType: 'short_text',
      options: [],
    },
    {
      id: 'e-2',
      pageId: 'p-1',
      position: 1,
      kind: 'question',
      fieldKey: 'format',
      label: 'Format',
      required: true,
      maxLength: null,
      questionType: 'single_choice',
      options: ['talk', 'workshop'],
    },
  ],
  conditionRules: [],
  routingRules: [],
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

function listUrl() {
  return `/api/admin/events/${EVENT_SLUG}/submissions`
}

function detailUrl() {
  return `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`
}

function versionUrl() {
  return `/api/admin/events/demo-conf-2026/forms/${FORM_ID}/versions/${VERSION_ID}`
}

function previewUrl() {
  return `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/acceptance-preview`
}

function reminderPreviewUrl() {
  return `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/reminder-preview`
}

function messagesUrl() {
  return `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/messages`
}

function acceptUrl() {
  return `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/accept`
}

function revisionsUrl() {
  return `/api/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}/revisions`
}

/** Acceptance state the detail page's acceptance panel reads. */
const ACCEPTANCE_PREVIEW = {
  submissionId: SUBMISSION_ID,
  kind: 'acceptance',
  toEmail: 'speaker.a@example.test',
  subject: 'Your proposal "My talk" is accepted for DemoConf 2026',
  body: 'Hi Speaker A,',
  accepted: false,
  // Undecided, spelled the one way the server spells it. The organizer badge
  // and the decision panel both read this field, never the boolean beside it.
  decision: 'pending',
  alreadySent: false,
  audience: [{ email: 'speaker.a@example.test', alreadySent: false }],
}

const REMINDER_PREVIEW = {
  ...ACCEPTANCE_PREVIEW,
  kind: 'reminder',
  subject: 'Reminder: your accepted proposal "My talk" for DemoConf 2026',
}

function roundsUrl() {
  return `/api/admin/events/${EVENT_SLUG}/rounds`
}

function assignmentsUrl() {
  return `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/assignments`
}

function summaryUrl() {
  return `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/evaluation-summary`
}

/**
 * The review-committee reads the detail page makes on behalf of its committee
 * panel. Their own contract lives in tests/unit/app/admin-evaluations.test.tsx;
 * here they only have to answer so the page's own states stay observable.
 */
function committeeResponse(url: string, method: string): Response | null {
  if (method !== 'GET') return null
  if (url === roundsUrl()) return jsonResponse([])
  if (url === assignmentsUrl()) return jsonResponse([])
  if (url === summaryUrl()) {
    return jsonResponse({
      submissionId: SUBMISSION_ID,
      eventId: 'event-1',
      title: 'My talk',
      currentRoundId: null,
      assignmentCount: 0,
      scoredCount: 0,
      scoreCount: 0,
      weightSum: 0,
      weightedTotal: 0,
      weightedAverageCentis: 0,
      criteria: [],
      rounds: [],
    })
  }
  return null
}

async function mountList(initialEntry = `/admin/events/${EVENT_SLUG}/submissions`) {
  const rootRoute = createRootRoute()
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions',
    component: SubmissionList,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  await router.load()
  const queryClient = createQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { queryClient, router }
}

async function mountDetail() {
  const rootRoute = createRootRoute()
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions',
    component: SubmissionList,
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$slug/submissions/$submissionId',
    component: SubmissionDetail,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, detailRoute]),
    history: createMemoryHistory({
      initialEntries: [`/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`],
    }),
  })
  await router.load()
  const queryClient = createQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { queryClient, router }
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === listUrl()) {
      return jsonResponse([SUBMISSION_LIST_ITEM])
    }
    if (method === 'GET' && url === detailUrl()) {
      return jsonResponse(SUBMISSION_DETAIL)
    }
    if (method === 'GET' && url === versionUrl()) {
      return jsonResponse(FORM_VERSION_DETAIL)
    }
    if (method === 'GET' && url === previewUrl()) {
      return jsonResponse(ACCEPTANCE_PREVIEW)
    }
    if (method === 'GET' && url === reminderPreviewUrl()) {
      return jsonResponse(REMINDER_PREVIEW)
    }
    if (method === 'GET' && url === messagesUrl()) {
      return jsonResponse([])
    }
    if (method === 'GET' && url === revisionsUrl()) {
      return jsonResponse([])
    }
    return (
      committeeResponse(url, method) ??
      jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    )
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

describe('organizer submissions', () => {
  it('exposes SubmissionList and SubmissionDetail as functions', () => {
    expect(SubmissionList).toBeTypeOf('function')
    expect(SubmissionDetail).toBeTypeOf('function')
  })

  it('renders the list as a real table with every required column header scoped col and row links', async () => {
    await mountList()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    for (const name of [
      'Title',
      'Primary speaker',
      'Co-speakers',
      'Form/Version',
      // R2-1.11: the cell renders the routing rule's action target, and the
      // header now says so instead of promising tracks and tags.
      'Routing',
      'Decision',
      'Submitted',
    ]) {
      const header = screen.getByRole('columnheader', { name })
      expect(header).toHaveAttribute('scope', 'col')
    }
    expect(screen.queryByRole('columnheader', { name: 'Track/Tags' })).not.toBeInTheDocument()

    // Identity, not status: the row link names the proposal and who is giving
    // it. The standing verdict lives in the Decision column.
    const rowLink = await screen.findByRole('link', {
      name: /^My talk.*Speaker A$/i,
    })
    expect(rowLink).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/submissions/${SUBMISSION_ID}`,
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('prints the standing decision in its own column, not in the row name', async () => {
    await mountList()
    await screen.findByRole('table')

    expect(screen.getByRole('columnheader', { name: 'Decision' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'My talk — Speaker A' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Pending/ })).not.toBeInTheDocument()
  })

  it('shows Accepted and Rejected chips from the list payload', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) {
        return jsonResponse([
          { ...SUBMISSION_LIST_ITEM, id: 's-acc', title: 'Yes talk', decision: 'accepted' },
          { ...SUBMISSION_LIST_ITEM, id: 's-rej', title: 'No talk', decision: 'rejected' },
        ])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()
    await screen.findByRole('table')
    expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0)
    expect(screen.getByText('Rejected')).toBeInTheDocument()
  })

  // R1-M10 + R1-M11 / F-R5-4: the whole row lights up on hover but only the
  // link navigates, and the identity column was the narrowest on the page.
  it('gives the row link the whole identity cell and the title column room to breathe', async () => {
    await mountList()
    await screen.findByRole('table')

    const row = screen.getAllByRole('row')[1]
    expect(within(row!).getAllByRole('link')).toHaveLength(1)
    const link = within(row!).getByRole('link')
    expect(link.className).toMatch(/w-\[calc\(100%\+0\.5rem\)\]/)
    expect(link.className).toMatch(/py-2/)

    const titleHeader = screen.getByRole('columnheader', { name: 'Title' })
    expect(titleHeader.className).toMatch(/min-w-\[15rem\]/)
    // No column absorbs the slack any more: `w-full` on one column is what
    // collapsed every other one to min-content.
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header.className.split(/\s+/)).not.toContain('w-full')
    }
  })

  // F-R5-5 call site: the pinned identity cell paints the row's own background
  // through the primitive rather than naming a second wash of its own.
  it('pins the identity column through the table primitive', async () => {
    await mountList()
    await screen.findByRole('table')

    const titleHeader = screen.getByRole('columnheader', { name: 'Title' })
    expect(titleHeader).toHaveAttribute('data-pinned', '')
    const cell = screen.getAllByRole('cell')[0]
    expect(cell).toHaveAttribute('data-pinned', '')
    expect(cell?.className ?? '').not.toContain('group-hover/row:bg-muted')
  })

  it('shows aria-busy while the list loads and clears it when data resolves', async () => {
    let resolveList: ((response: Response) => void) | undefined
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) {
        return new Promise<Response>((resolve) => {
          resolveList = resolve
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()

    const region = await screen.findByRole('region', { name: /submissions/i })
    expect(region).toHaveAttribute('aria-busy', 'true')

    resolveList?.(jsonResponse([SUBMISSION_LIST_ITEM]))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(region).toHaveAttribute('aria-busy', 'false')
  })

  it('renders a polite empty state with the exact action label', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) {
        return jsonResponse([])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()

    const status = await screen.findByRole('status', { name: /no submissions/i })
    expect(status).toHaveTextContent(/no submissions/i)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })

  it('renders an error alert with a retry that issues exactly one list GET', async () => {
    const user = userEvent.setup()
    let fails = true
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) {
        if (fails) {
          fails = false
          return jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500)
        }
        return jsonResponse([SUBMISSION_LIST_ITEM])
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unable to load/i)
    expect(alert).not.toHaveTextContent('boom')
    expect(fetchMock.mock.calls.length).toBe(1)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(fetchMock.mock.calls.length).toBe(2)
    const retried = fetchMock.mock.calls[1] as [RequestInfo | URL, RequestInit?] | undefined
    expect(retried).toBeDefined()
    expect(requestUrl(retried?.[0] ?? '')).toBe(listUrl())
    expect(retried?.[1]?.method ?? 'GET').toBe('GET')
  })

  // R4-note: 403 used to print "Not found" here, so an organizer route opened
  // by a session that is not an organizer's claimed the page did not exist.
  // 404 keeps carrying absent AND cross-event ids (both answered identically by
  // every admin route), so nothing about what exists leaks either way.
  it('answers each denial in its own words and leaks nothing about the record', async () => {
    for (const state of [
      { status: 401, code: 'unauthorized', heading: 'Session expired' },
      { status: 403, code: 'forbidden', heading: 'Access forbidden' },
      { status: 404, code: 'not_found', heading: 'Not found' },
    ] as const) {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === listUrl()) {
          return jsonResponse({ error: { code: state.code, message: 'server copy' } }, state.status)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      await mountList()

      expect(await screen.findByRole('heading', { name: state.heading })).toBeInTheDocument()
      if (state.status === 401) {
        expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
        expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
      }
      const rendered = document.body.textContent ?? ''
      expect(rendered).not.toContain('server copy')
      expect(rendered).not.toContain('My talk')
      expect(rendered).not.toContain('Speaker A')
      expect(rendered).not.toContain('speaker.a@example.test')
      expect(rendered).not.toContain(SUBMISSION_ID)
      cleanup()
    }
  })

  // TA1-P13: how many proposals, said about the rows on screen — and said
  // beside the h1 rather than inside it, because the heading is a focus target
  // whose accessible name is contracted.
  it('states the count of the rows it is showing, outside the heading', async () => {
    await mountList()
    await screen.findByRole('table')

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveAccessibleName('Submissions')
    expect(heading.textContent).toBe('Submissions')

    const description = document.querySelector('[data-slot="page-header-description"]')
    expect(description).toHaveTextContent('1 proposal from the call for papers.')
    // The number is the length of the visible list, not a second read: as many
    // row links in the table as the sentence claims proposals.
    expect(within(screen.getByRole('table')).getAllByRole('link')).toHaveLength(1)
    // Metadata, not an announcement: nothing here becomes a live region.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the count sentence out of the way until there are rows', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) return jsonResponse([])
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()
    await screen.findByText(/no submissions yet/i)

    const description = document.querySelector('[data-slot="page-header-description"]')
    // "0 proposals" answers a question nobody asked on a page whose empty
    // state is already explaining itself.
    expect(description).toHaveTextContent('Proposals arrive here from the call for papers.')
    expect(description?.textContent ?? '').not.toMatch(/\d/)
  })

  it('peeks the selected proposal beside the list without leaving the desk', async () => {
    const user = userEvent.setup()
    const second = {
      ...SUBMISSION_LIST_ITEM,
      id: 'submission-2',
      title: 'Workshop on incremental builds',
      primarySpeaker: {
        ...SUBMISSION_LIST_ITEM.primarySpeaker,
        contactId: 'contact-2',
        name: 'Speaker B',
        email: 'speaker.b@example.test',
      },
    }
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) return jsonResponse([SUBMISSION_LIST_ITEM, second])
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()
    await screen.findByRole('table')
    const peek = document.querySelector('[data-slot="submissions-peek"]')
    expect(peek).toHaveTextContent('My talk')
    await user.click(screen.getByText('Speaker B'))
    expect(document.querySelector('[data-slot="submissions-peek"]')).toHaveTextContent(
      'Workshop on incremental builds',
    )
    expect(screen.getByRole('link', { name: /open proposal/i })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/submissions/submission-2`,
    )
  })

  it('moves the desk spotlight with j and deep-links ?spotlight=', async () => {
    const user = userEvent.setup()
    const second = {
      ...SUBMISSION_LIST_ITEM,
      id: 'submission-2',
      title: 'Workshop on incremental builds',
      primarySpeaker: {
        ...SUBMISSION_LIST_ITEM.primarySpeaker,
        contactId: 'contact-2',
        name: 'Speaker B',
        email: 'speaker.b@example.test',
      },
    }
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) return jsonResponse([SUBMISSION_LIST_ITEM, second])
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()
    await screen.findByRole('table')
    await user.keyboard('j')
    await user.keyboard('j')
    expect(document.querySelector('[data-slot="submissions-canvas"]')).toHaveAttribute(
      'data-spotlight',
      'submission-2',
    )
    expect(window.location.search).toContain('spotlight=submission-2')
    expect(document.querySelector('[data-slot="submissions-peek"]')).toHaveTextContent(
      'Workshop on incremental builds',
    )
  })

  it('narrows the desk by title or speaker', async () => {
    const user = userEvent.setup()
    const second = {
      ...SUBMISSION_LIST_ITEM,
      id: 'submission-2',
      title: 'Workshop on incremental builds',
      primarySpeaker: {
        ...SUBMISSION_LIST_ITEM.primarySpeaker,
        contactId: 'contact-2',
        name: 'Speaker B',
        email: 'speaker.b@example.test',
      },
    }
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === listUrl()) return jsonResponse([SUBMISSION_LIST_ITEM, second])
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountList()
    await screen.findByRole('table')
    await user.type(screen.getByLabelText(/search submissions/i), 'Workshop')
    expect(screen.getAllByText('Workshop on incremental builds').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /my talk — speaker a/i })).not.toBeInTheDocument()
  })

  it('renders no counters or dashboard summary elements', async () => {
    await mountList()
    await screen.findByRole('table')
    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toMatch(/\d+\s*(submissions?|pending|total)/i)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders the detail snapshot with committed labels, version, pending, read-only, and a back link', async () => {
    await mountDetail()

    expect(await screen.findByRole('heading', { name: 'My talk' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText(/version 1/i)).toBeInTheDocument()
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Format')).toBeInTheDocument()
    expect(screen.getByText('On this proposal')).toBeInTheDocument()
    expect(screen.getByText('Speaker A')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to submissions/i })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/submissions`,
    )

    const rendered = document.body.textContent ?? ''
    expect(rendered).not.toMatch(/\btitle\b/)
    expect(rendered).not.toMatch(/\bformat\b/)
    expect(rendered).not.toContain(SUBMISSION_ID)
    // The answers stay read-only: the only controls on the page are the
    // acceptance actions, and nothing on the snapshot is editable.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  // TA6-T8: the page a judge spends the most time on never said when the
  // proposal arrived, though the list they clicked in from prints it.
  it('says when the proposal was submitted, without touching the h1', async () => {
    await mountDetail()

    const heading = await screen.findByRole('heading', { level: 1, name: 'My talk' })
    // The heading is a focus target with a contracted accessible name; the
    // date sits outside it.
    expect(heading).toHaveAccessibleName('My talk')
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading.textContent).toBe('My talk')

    const description = document.querySelector('[data-slot="page-header-description"]')
    expect(description).toHaveTextContent('Submitted Aug 8, 2026, 12:00 PM')
    // `submittedAt`, named for what it is — the machine instant stays on the
    // attribute, and the wire format is never the words.
    const submitted = description?.querySelector('time')
    expect(submitted).toHaveAttribute('datetime', SUBMISSION_DETAIL.submittedAt)
    expect(submitted?.textContent).not.toBe(SUBMISSION_DETAIL.submittedAt)
  })

  // TA5-P1/P12: one meaning per shape. A lifecycle state carries the marker a
  // reader without colour can still see; an annotation about the form version
  // does not, because it is not a state at all.
  it('marks the acceptance state as a state and the version as an annotation', async () => {
    await mountDetail()
    await screen.findByRole('heading', { level: 1, name: 'My talk' })

    const state = screen.getByText('Pending').closest('[data-slot="badge"]')
    expect(state).toHaveAttribute('data-dot', '')
    // Nothing is in the air on load, so the marker is still rather than
    // breathing.
    expect(state).not.toHaveAttribute('data-pending')

    const version = screen.getByText(/version 1/i).closest('[data-slot="badge"]')
    expect(version).not.toHaveAttribute('data-dot')
    expect(version?.className ?? '').not.toContain('before:')
  })

  // The proposal is a reading column, not a `1fr` track. A full-width first
  // column parked the rail at the viewport edge and framed ~1500px of empty
  // card around short answers. The group stays left: proposal `max-w-3xl`,
  // rail 26rem beside it.
  it('holds the proposal and its rail in two columns, neither of them a void', async () => {
    await mountDetail()
    await screen.findByRole('heading', { name: 'My talk' })

    const canvas = document.querySelector('[data-slot="submission-canvas"]')
    expect(canvas).not.toBeNull()
    expect(canvas?.className ?? '').toMatch(/xl:flex-row/)
    expect(canvas?.className ?? '').toMatch(/xl:items-start/)
    expect(canvas?.className ?? '').not.toMatch(/1fr/)

    const proposal = document.querySelector('[data-slot="submission-proposal"]')
    expect(proposal?.className ?? '').toMatch(/max-w-3xl/)

    const rail = document.querySelector('[data-slot="submission-rail"]')
    expect(rail).not.toBeNull()
    expect(rail?.className ?? '').toMatch(/xl:w-\[26rem\]/)

    const answersCard = screen.getByText('Title').closest('[data-slot="card"]')
    expect(answersCard).not.toBeNull()
    expect(
      within(answersCard as HTMLElement).getByRole('heading', { name: 'Proposal' }),
    ).toBeInTheDocument()
    expect(
      within(answersCard as HTMLElement).getByRole('button', { name: 'Edit session content' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Title').closest('div')?.className ?? '').not.toMatch(/62ch/)
  })

  it('opens the session editor inside the proposal card and closes it again', async () => {
    const user = userEvent.setup()
    await mountDetail()
    const edit = await screen.findByRole('button', { name: 'Edit session content' })
    await user.click(edit)

    expect(screen.getByLabelText('Session title')).toBeInTheDocument()
    expect(screen.getByLabelText('Abstract')).toBeInTheDocument()
    expect(document.getElementById('session-content-editor')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(screen.queryByLabelText('Session title')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit session content' })).toBeInTheDocument()
  })

  it('reaches acceptance from the per-submission page and reflects the acceptance state', async () => {
    const user = userEvent.setup()
    let accepted = false
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === detailUrl()) return jsonResponse(SUBMISSION_DETAIL)
      if (method === 'GET' && url === versionUrl()) return jsonResponse(FORM_VERSION_DETAIL)
      if (method === 'GET' && url === previewUrl()) {
        // Both fields move together, exactly as the server derives them.
        return jsonResponse({
          ...ACCEPTANCE_PREVIEW,
          accepted,
          decision: accepted ? 'accepted' : 'pending',
        })
      }
      if (method === 'GET' && url === messagesUrl()) return jsonResponse([])
      if (method === 'POST' && url === acceptUrl()) {
        accepted = true
        return jsonResponse({
          submissionId: SUBMISSION_ID,
          eventId: SUBMISSION_DETAIL.eventId,
          acceptedAt: '2026-08-09T09:00:00.000Z',
          alreadyAccepted: false,
          tasks: [],
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountDetail()

    await screen.findByRole('heading', { name: 'My talk' })
    const accept = await screen.findByRole('button', { name: 'Accept proposal' })
    expect(screen.getByText('Pending')).toBeInTheDocument()

    await user.click(accept)
    // Accepting passes through its own confirmation now.
    await user.click(await screen.findByRole('button', { name: 'Confirm acceptance' }))

    // Exactly two surfaces say it, and the count is pinned rather than merely
    // non-zero: the page's own status chip, and the decision panel stating the
    // verdict it now holds. A loose "at least one" here would pass just as
    // happily if one of them silently stopped saying it.
    await waitFor(() => expect(screen.getAllByText('Accepted')).toHaveLength(2))
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()
  })

  /**
   * A rejected proposal keeps its acceptance record, so the preview's
   * `accepted` boolean is STILL TRUE here — deliberately, because that is the
   * shape the server really sends. A badge reading that boolean tells the
   * organizer the proposal they just declined is "Accepted", which is the one
   * thing this page must never say. The verdict is the field to believe.
   */
  it('shows a rejected proposal as rejected, not as accepted', async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === detailUrl()) return jsonResponse(SUBMISSION_DETAIL)
      if (method === 'GET' && url === versionUrl()) return jsonResponse(FORM_VERSION_DETAIL)
      if (method === 'GET' && url === previewUrl()) {
        return jsonResponse({ ...ACCEPTANCE_PREVIEW, accepted: true, decision: 'rejected' })
      }
      if (method === 'GET' && url === messagesUrl()) return jsonResponse([])
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await mountDetail()

    await screen.findByRole('heading', { name: 'My talk' })
    await waitFor(() => expect(screen.queryByText('Accepted')).not.toBeInTheDocument())
    expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0)
  })

  it('focuses the route h1 on entry with tabIndex -1 and no control autofocus', async () => {
    await mountDetail()

    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(h1).toHaveAttribute('tabindex', '-1')
    expect(h1).toHaveFocus()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('answers each detail denial in its own words and leaks nothing about the record', async () => {
    for (const state of [
      { status: 401, code: 'unauthorized', heading: 'Session expired' },
      { status: 403, code: 'forbidden', heading: 'Access forbidden' },
      { status: 404, code: 'not_found', heading: 'Not found' },
    ] as const) {
      fetchHandler = (url, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET' && url === detailUrl()) {
          return jsonResponse({ error: { code: state.code, message: 'server copy' } }, state.status)
        }
        if (method === 'GET' && url === versionUrl()) {
          return jsonResponse({ error: { code: state.code, message: 'server copy' } }, state.status)
        }
        return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      }
      await mountDetail()

      expect(await screen.findByRole('heading', { name: state.heading })).toBeInTheDocument()
      if (state.status === 401) {
        expect(screen.getByRole('alert')).toHaveTextContent(/session has expired/i)
        expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
      }
      const rendered = document.body.textContent ?? ''
      expect(rendered).not.toContain('server copy')
      expect(rendered).not.toContain('My talk')
      expect(rendered).not.toContain('Speaker A')
      expect(rendered).not.toContain('speaker.a@example.test')
      expect(rendered).not.toContain(SUBMISSION_ID)
      cleanup()
    }
  })

  // R2-1.5(a): a proposal whose fields were all optional or conditionally
  // hidden used to render an empty <dl> — a card with nothing in it and no
  // explanation of why.
  it('explains an answerless proposal instead of rendering an empty list', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === detailUrl()) {
        return jsonResponse({ ...SUBMISSION_DETAIL, answers: {} })
      }
      if (method === 'GET' && url === versionUrl()) return jsonResponse(FORM_VERSION_DETAIL)
      if (method === 'GET' && url === previewUrl()) return jsonResponse(ACCEPTANCE_PREVIEW)
      if (method === 'GET' && url === reminderPreviewUrl()) return jsonResponse(REMINDER_PREVIEW)
      if (method === 'GET' && url === messagesUrl()) return jsonResponse([])
      return (
        committeeResponse(url, method) ??
        jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      )
    }
    await mountDetail()

    await screen.findByRole('heading', { name: 'My talk' })
    const empty = document.querySelector('[data-slot="empty-state"]')
    expect(empty).not.toBeNull()
    expect(empty).toHaveTextContent('No answers were submitted')
    expect(empty).toHaveTextContent(/optional or hidden/i)
    expect(document.querySelector('[data-slot="submission-proposal"] dl')).toBeNull()
  })

  it('retries the failed version query when only the form-version GET fails', async () => {
    const user = userEvent.setup()
    let versionFails = true
    let versionGets = 0
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === detailUrl()) {
        return jsonResponse(SUBMISSION_DETAIL)
      }
      if (method === 'GET' && url === versionUrl()) {
        versionGets += 1
        if (versionFails) {
          versionFails = false
          return jsonResponse({ error: { code: 'internal', message: 'boom' } }, 500)
        }
        return jsonResponse(FORM_VERSION_DETAIL)
      }
      if (method === 'GET' && url === previewUrl()) {
        return jsonResponse(ACCEPTANCE_PREVIEW)
      }
      if (method === 'GET' && url === messagesUrl()) {
        return jsonResponse([])
      }
      return (
        committeeResponse(url, method) ??
        jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
      )
    }
    await mountDetail()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unable to load/i)
    expect(versionGets).toBe(1)

    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(versionGets).toBe(2)
    expect(await screen.findByText('Title')).toBeInTheDocument()
    expect(await screen.findByText('Format')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('issues the exact committed GET sets per load with no unrelated fetches', async () => {
    await mountList()
    await screen.findByRole('table')
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(listUrl())
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('include')

    cleanup()
    fetchMock.mockClear()
    await mountDetail()
    await screen.findByRole('heading', { level: 1 })
    // The detail page owns both acceptance and evaluation surfaces, so its
    // committed read set includes both panels as well as the snapshot.
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBe(8)
    })
    const byUrl = (left: { url: string }, right: { url: string }) =>
      left.url.localeCompare(right.url)
    const urls = fetchMock.mock.calls
      .map(([input, init]) => ({
        url: requestUrl(input),
        method: init?.method ?? 'GET',
        credentials: init?.credentials,
      }))
      .sort(byUrl)
    expect(urls).toEqual(
      [
        { url: detailUrl(), method: 'GET', credentials: 'include' },
        { url: versionUrl(), method: 'GET', credentials: 'include' },
        { url: previewUrl(), method: 'GET', credentials: 'include' },
        { url: reminderPreviewUrl(), method: 'GET', credentials: 'include' },
        { url: messagesUrl(), method: 'GET', credentials: 'include' },
        { url: roundsUrl(), method: 'GET', credentials: 'include' },
        { url: assignmentsUrl(), method: 'GET', credentials: 'include' },
        { url: summaryUrl(), method: 'GET', credentials: 'include' },
      ].sort(byUrl),
    )
  })
})
