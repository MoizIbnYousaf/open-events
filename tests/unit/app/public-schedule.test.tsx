import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPublicSchedule, usePublicSchedule } from '../../../src/app/queries/public-schedule'
import PublicSchedulePage from '../../../src/app/features/public/PublicSchedulePage'
import {
  Route as PublicScheduleRoute,
  PublicSchedulePage as PublicScheduleRoutePage,
} from '../../../src/app/routes/_public/schedule.$eventSlug'

// Public schedule contract: GET /api/public/events/:slug/schedule returns a
// { timezone, sessions } envelope with published-only, PII-stripped data.
// The page owns its h1 per state, exposes loading status, keeps fetches
// exact, sanitizes 404/error states, and renders the five schedule views with
// real table semantics and timezone-aware times.

const EVENT_SLUG = 'demo-conf-2026'
const SCHEDULE_URL = `/api/public/events/${EVENT_SLUG}/schedule`

const SCHEDULE_ENVELOPE = {
  timezone: 'Europe/Berlin',
  eventName: 'DemoConf 2026',
  logoUrl: null,
  logoWidth: null,
  logoHeight: null,
  backgroundUrl: null,
  backgroundWidth: null,
  backgroundHeight: null,
  sessions: [
    {
      submissionId: 'submission-1',
      title: 'My talk',
      speakers: ['Speaker A'],
      track: 'Talk',
      room: 'Main hall',
      day: '2026-05-13',
      start: '2026-05-13T09:00:00.000Z',
      end: '2026-05-13T10:00:00.000Z',
      position: 0,
    },
    {
      submissionId: 'submission-2',
      title: 'Hands-on workshop',
      speakers: ['Speaker B'],
      track: 'Workshop',
      room: 'Workshop A',
      day: '2026-05-20',
      start: '2026-05-20T09:00:00.000Z',
      end: '2026-05-20T12:00:00.000Z',
      position: 0,
    },
  ],
} as const

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

async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <PublicSchedulePage eventSlug={EVENT_SLUG} />
    </QueryClientProvider>,
  )
  return { queryClient }
}

type ScheduleState = 'loading' | 'error' | 'not-found' | 'empty' | 'ready'

async function mountPage(state: ScheduleState) {
  if (state === 'loading') {
    fetchHandler = () => new Promise<Response>(() => undefined)
  } else if (state === 'error') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === SCHEDULE_URL) {
        return jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else if (state === 'not-found') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === SCHEDULE_URL) {
        return jsonResponse(
          { error: { code: 'not_found', message: 'No such event raw copy' } },
          404,
        )
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else if (state === 'empty') {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === SCHEDULE_URL) {
        return jsonResponse({ timezone: 'Europe/Berlin', sessions: [] })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  } else {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === SCHEDULE_URL) {
        return jsonResponse(SCHEDULE_ENVELOPE)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
  }
  return renderPage()
}

beforeEach(() => {
  fetchHandler = (url, init) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === SCHEDULE_URL) {
      return jsonResponse(SCHEDULE_ENVELOPE)
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

describe('public schedule', () => {
  it('registers the public schedule route with the production page', () => {
    expect(PublicScheduleRoute.options.path).toBe('/schedule/$eventSlug')
    expect(PublicScheduleRoute.options.component).toBe(PublicScheduleRoutePage)
    expect(PublicScheduleRoutePage).toBe(PublicSchedulePage)
  })

  it.each([
    ['ready', 'Schedule'],
    ['empty', 'Schedule'],
    ['error', 'Schedule'],
  ] as const)(
    'renders exactly one page-owned h1 in the %s state, never the brand',
    async (state, title) => {
      await mountPage(state)

      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
      const h1s = screen.getAllByRole('heading', { level: 1 })
      expect(h1s).toHaveLength(1)
      expect(h1s[0]).not.toHaveTextContent('Open Events')
    },
  )

  it('renders configured artwork without another event request', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === SCHEDULE_URL) {
        return jsonResponse({
          ...SCHEDULE_ENVELOPE,
          logoUrl: '/api/public/events/demo-conf-2026/branding/logo?v=1',
          logoWidth: 512,
          logoHeight: 256,
          backgroundUrl: '/api/public/events/demo-conf-2026/branding/background?v=1',
          backgroundWidth: 1600,
          backgroundHeight: 900,
        })
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await renderPage()

    expect(await screen.findByRole('img', { name: 'DemoConf 2026 logo' })).toHaveAttribute(
      'width',
      '512',
    )
    expect(screen.getByRole('img', { name: 'DemoConf 2026 background' })).toHaveAttribute(
      'src',
      '/api/public/events/demo-conf-2026/branding/background?v=1',
    )
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it('keeps the loading state heading-free with aria-busy and a status, cleared after ready', async () => {
    let resolveSchedule: ((response: Response) => void) | undefined
    fetchHandler = () =>
      new Promise<Response>((resolve) => {
        resolveSchedule = resolve
      })
    await renderPage()

    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByRole('status')).toBeInTheDocument()

    resolveSchedule?.(jsonResponse(SCHEDULE_ENVELOPE))
    expect(await screen.findByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('fetches exactly GET /api/public/events/:slug/schedule with no unrelated calls', async () => {
    await mountPage('ready')

    await screen.findByRole('heading', { level: 1, name: 'Schedule' })
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(SCHEDULE_URL)
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')
  })

  it('maps a 404 to a sanitized not-found state without raw server copy', async () => {
    await mountPage('not-found')

    expect(await screen.findByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('No such event raw copy')
  })

  it('shows generic error copy without raw server leakage', async () => {
    await mountPage('error')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Unable to load the schedule.')
    expect(document.body.textContent ?? '').not.toContain('boom raw server copy')
  })

  it('renders the five REQ-014 views with table semantics, timezone-aware times, and labels only', async () => {
    await mountPage('ready')

    await screen.findByRole('heading', { level: 1, name: 'Schedule' })
    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBeGreaterThan(0)
    for (const header of headers) {
      expect(header).toHaveAttribute('scope', 'col')
    }
    const rendered = document.body.textContent ?? ''
    for (const view of ['List', 'Day', 'Week', 'Track', 'Room']) {
      expect(rendered).toContain(view)
    }
    expect(rendered).toContain('My talk')
    expect(rendered).toContain('Speaker A')
    expect(rendered).toContain('Hands-on workshop')
    expect(rendered).toContain('Talk')
    expect(rendered).toContain('Main hall')
    expect(rendered).toContain('2026-05-13')
    expect(rendered).toContain('11:00')
    expect(rendered).not.toContain('speaker.a@example.test')
    expect(rendered).not.toContain('contact-1')
  })

  it('offers a pending-aware retry instead of a dead-end error', async () => {
    const user = userEvent.setup()
    await mountPage('error')

    await screen.findByRole('alert')
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(fetchMock.mock.calls).toHaveLength(1)

    // The refetch is reader-pressed: nothing retries behind their back.
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === SCHEDULE_URL) return jsonResponse(SCHEDULE_ENVELOPE)
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    await user.click(retry)

    expect(await screen.findByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument()
    expect(fetchMock.mock.calls).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('names every view table for assistive tech with an sr-only caption', async () => {
    await mountPage('ready')

    await screen.findByRole('heading', { level: 1, name: 'Schedule' })
    const captions = Array.from(document.querySelectorAll('table > caption'))
    expect(captions).toHaveLength(6)
    for (const caption of captions) {
      expect(caption).toHaveClass('sr-only')
      expect((caption.textContent ?? '').length).toBeGreaterThan(0)
    }
    // Each of the five regions still owns its own horizontally scrollable box,
    // so a wide table slides inside the card rather than moving the page.
    for (const view of ['List', 'Day', 'Week', 'Track', 'Room']) {
      const region = screen.getByRole('region', { name: view })
      expect(region.querySelector('.overflow-x-auto')).not.toBeNull()
    }
  })

  it('exports only after a session is starred and scopes the iCal link', async () => {
    const user = userEvent.setup()
    window.localStorage.clear()
    await mountPage('ready')
    await screen.findByRole('heading', { level: 1, name: 'Schedule' })
    expect(screen.queryByRole('link', { name: /calendar/i })).not.toBeInTheDocument()
    expect(screen.getByText(/add a session to my schedule/i)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /add to my schedule/i })[0]!)
    expect(screen.getByText(/1 session saved on this device/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /my schedule to calendar/i })).toHaveAttribute(
      'href',
      `/api/public/events/${EVENT_SLUG}/schedule.ics?ids=submission-1`,
    )
    expect(screen.getByRole('button', { name: /remove from my schedule/i })).toBeInTheDocument()
    cleanup()
    await mountPage('ready')
    expect(await screen.findByText(/1 session saved on this device/i)).toBeInTheDocument()
  })

  it('renders a track as an enumerated value, never wearing the state face', async () => {
    await mountPage('ready')

    await screen.findByRole('heading', { level: 1, name: 'Schedule' })
    const chips = screen.getAllByText('Workshop', { selector: '[data-slot="badge"]' })
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      // A track is one value out of a set the organizer wrote down. It is not
      // a state anything can be in, so it carries no state marker and none of
      // the tinted "this went well" face the organizer surfaces spend on
      // accepted / published / ready.
      expect(chip).not.toHaveAttribute('data-dot')
      expect(chip).not.toHaveAttribute('data-pending')
      expect(chip).toHaveAttribute('data-variant', 'outline')
    }
  })

  it('frames each view on the scroller itself, with nothing clipping its focus ring', async () => {
    await mountPage('ready')

    await screen.findByRole('heading', { level: 1, name: 'Schedule' })
    for (const view of ['List', 'Day', 'Week', 'Track', 'Room']) {
      const region = screen.getByRole('region', { name: view })
      const scroller = region.querySelector('[data-slot="table-container"]')
      expect(scroller).not.toBeNull()
      // The frame is the scroller's own, so the rounding follows the content
      // instead of sitting on a box the content scrolls past.
      expect(scroller).toHaveClass('rounded-lg', 'ring-1')
      // The scroller is a tab stop and its focus indicator paints OUTWARD, so
      // no ancestor between it and the region may clip. A wrapper with
      // `overflow-hidden` used to sit exactly here and cut the ring away.
      let ancestor = scroller?.parentElement ?? null
      while (ancestor !== null && ancestor !== region) {
        expect(ancestor.className).not.toMatch(/\boverflow-hidden\b/)
        ancestor = ancestor.parentElement
      }
      expect(ancestor).toBe(region)
    }
  })

  it('uses the schedule query key for usePublicSchedule', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    function Probe() {
      const query = usePublicSchedule(EVENT_SLUG)
      return <div>{query.isSuccess ? 'loaded' : 'pending'}</div>
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    )

    await screen.findByText('loaded')
    expect(queryClient.getQueryState(['public', 'schedule', EVENT_SLUG])?.status).toBe('success')
  })

  it('getPublicSchedule GETs the exact URL, maps 404 to null, and propagates other errors', async () => {
    fetchHandler = (url, init) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === SCHEDULE_URL) {
        return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404)
      }
      return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
    }
    expect(await getPublicSchedule(EVENT_SLUG)).toBeNull()
    expect(fetchMock.mock.calls).toHaveLength(1)
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(SCHEDULE_URL)
    expect(fetchMock.mock.calls[0]?.[1]?.method ?? 'GET').toBe('GET')

    fetchHandler = () =>
      jsonResponse({ error: { code: 'internal', message: 'boom raw server copy' } }, 500)
    await expect(getPublicSchedule(EVENT_SLUG)).rejects.toThrow()
  })
})
