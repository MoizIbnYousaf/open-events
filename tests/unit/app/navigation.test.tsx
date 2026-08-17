import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../../../src/app/query-client'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'
import { routeTree } from '../../../src/app/routeTree.gen'
import { DEFAULT_EVENT_SLUG, DEFAULT_FORM_SLUG } from '../../../src/app/lib/default-event'
import {
  organizerDestinations,
  publicDestinations,
  speakerDestinations,
} from '../../../src/app/features/nav/nav-model'

const ROOT = resolve(import.meta.dirname, '../../..')
const EVENT_SLUG = DEFAULT_EVENT_SLUG

const EVENT_CONFIG_DTO = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: EVENT_SLUG,
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  startsAt: null,
  endsAt: null,
  websiteUrl: null,
  organizerContact: null,
  venue: null,
  eventType: null,
}

const PUBLISHED_FORM = {
  formId: 'f0000000-0000-4000-8000-000000000001',
  eventId: EVENT_CONFIG_DTO.id,
  slug: 'cfp',
  status: 'published',
  publishedVersionId: 'f0000000-0000-4000-8000-000000000002',
}

const FORM_VERSION_DETAIL = {
  formId: PUBLISHED_FORM.formId,
  eventId: EVENT_CONFIG_DTO.id,
  versionId: PUBLISHED_FORM.publishedVersionId,
  version: 1,
  status: 'published',
  contentHash: null,
  publishedAt: '2026-08-08T09:00:00.000Z',
  updatedAt: '2026-08-08T09:00:00.000Z',
  pages: [{ id: 'p-1', position: 0, kind: 'welcome', title: 'Welcome', content: '' }],
  elements: [],
}

let fetchMock: ReturnType<typeof vi.fn>
let fetchHandler: (url: string, init?: RequestInit) => Response

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function defaultHandler(url: string): Response {
  if (url === `/api/admin/events/${EVENT_SLUG}`) return jsonResponse(EVENT_CONFIG_DTO)
  if (url === `/api/admin/events/${EVENT_SLUG}/forms`) return jsonResponse([PUBLISHED_FORM])
  if (url === `/api/admin/events/${EVENT_SLUG}/taxonomies`) {
    return jsonResponse({ eventId: EVENT_CONFIG_DTO.id, items: [] })
  }
  if (url === `/api/admin/events/${EVENT_SLUG}/submissions`) return jsonResponse([])
  if (url === `/api/admin/events/${EVENT_SLUG}/readiness`) {
    return jsonResponse({ eventId: EVENT_CONFIG_DTO.id, submissions: [] })
  }
  if (url.startsWith('/api/support-chat')) {
    return jsonResponse({ role: 'none', needsIdentity: true, chat: null, guestToken: null })
  }
  if (url === `/api/admin/events/${EVENT_SLUG}/agenda`) return jsonResponse({ sessions: [] })
  if (url === `/api/admin/events/${EVENT_SLUG}/criteria`) return jsonResponse([])
  if (url === `/api/admin/events/${EVENT_SLUG}/rounds`) return jsonResponse([])
  if (
    url ===
    `/api/admin/events/demo-conf-2026/forms/${PUBLISHED_FORM.formId}/versions/${PUBLISHED_FORM.publishedVersionId}`
  ) {
    return jsonResponse(FORM_VERSION_DETAIL)
  }
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

beforeEach(() => {
  fetchHandler = defaultHandler
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(fetchHandler(requestUrl(input), init)),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

function mountAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <RouterProvider router={router as any} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return { router, user: userEvent.setup() }
}

describe('nav model', () => {
  it('exposes the organizer destinations the product actually has', () => {
    expect(organizerDestinations(EVENT_SLUG).map((d) => d.label)).toEqual([
      'Events',
      'Event settings',
      'Taxonomies',
      'Submissions',
      // The people, beside the proposals. Every speaker-facing surface existed
      // before this destination did, so the work speakers were doing arrived on
      // a screen no organizer had.
      'Speakers',
      // What the event has actually said, and to whom.
      'Messages',
      'Readiness',
      // Not "Evaluations": the page this opens is titled Review committee, and
      // the product has a separate speaker-facing /evaluations surface. One
      // label for two destinations made the rail contradict the page it opened.
      'Review committee',
      'Agenda',
      'Embeds',
      'Files',
      'Organizer support',
    ])
    for (const destination of organizerDestinations(EVENT_SLUG)) {
      if (destination.to.includes('$slug')) {
        expect(destination.params?.slug).toBe(EVENT_SLUG)
      }
    }
  })

  it('leaves no route without an inbound link', () => {
    // The route tree is the authority; a new route must be added to the nav
    // model or to this justified exception list, never silently orphaned.
    const generated = readFileSync(resolve(ROOT, 'src/app/routeTree.gen.ts'), 'utf8')
    const block = generated.slice(
      generated.indexOf('export interface FileRoutesByFullPath {'),
      generated.indexOf('export interface FileRoutesByTo {'),
    )
    const declared = new Set(
      Array.from(block.matchAll(/^\s*'([^']+)':/gm), (match) => match[1] ?? ''),
    )
    expect(declared.size).toBeGreaterThan(10)
    const linked = new Set<string>([
      ...organizerDestinations(EVENT_SLUG).map((d) => d.to),
      ...speakerDestinations().map((d) => d.to),
      ...publicDestinations(EVENT_SLUG, DEFAULT_FORM_SLUG).map((d) => d.to),
      '/',
      '/admin',
      // Reached from the list that owns them.
      '/admin/events/$slug/submissions/$submissionId',
      '/admin/events/$slug/forms/$formId',
      '/admin/events/$slug/forms/$formId/versions/$versionId',
      // Redirect target only: the app sends an unauthenticated speaker here.
      '/start',
      // Deliberately unlinked (DEC-016): no /api/public/evaluations handler
      // exists in this candidate, so a nav link would be a control that cannot
      // do anything. Delete this line when the evaluations API lands.
      '/evaluations',
      '/speakers/$eventSlug/$contactId',
      '/embed/$embedId',
      '/admin/events/',
    ])
    const orphans = Array.from(declared).filter((path) => !linked.has(path))
    expect(orphans).toEqual([])
  })

  it('separates the speaker surfaces from the public programme', () => {
    expect(speakerDestinations().every((d) => d.group === 'Speaker')).toBe(true)
    expect(
      publicDestinations(EVENT_SLUG, DEFAULT_FORM_SLUG).every((d) => d.group === 'Public'),
    ).toBe(true)
  })
})

describe('rendered navigation', () => {
  it('reaches every organizer destination by clicking a link', async () => {
    const { router, user } = mountAt(`/admin/events/${EVENT_SLUG}`)
    await screen.findByRole('navigation', { name: 'Event' })

    for (const destination of organizerDestinations(EVENT_SLUG)) {
      const nav = screen.getByRole('navigation', { name: 'Event' })
      await user.click(within(nav).getByRole('link', { name: destination.label }))
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(destination.to.replace('$slug', EVENT_SLUG)),
      )
    }
  }, 15_000)

  it('names the committee destination after the page it opens', async () => {
    mountAt(`/admin/events/${EVENT_SLUG}`)

    const nav = await screen.findByRole('navigation', { name: 'Event' })
    // The rail said "Evaluations" and opened a page titled "Review committee",
    // while a separate speaker-facing /evaluations surface existed under the
    // same word. The rail is the label of record; the palette follows it.
    expect(within(nav).getByRole('link', { name: 'Review committee' })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_SLUG}/evaluations`,
    )
    expect(within(nav).queryByRole('link', { name: 'Evaluations' })).toBeNull()
  })

  it('marks the current organizer destination', async () => {
    mountAt(`/admin/events/${EVENT_SLUG}/readiness`)

    const nav = await screen.findByRole('navigation', { name: 'Event' })
    expect(within(nav).getByRole('link', { name: 'Readiness' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Submissions' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('offers unified sign-in from the site shell without adding a heading', async () => {
    mountAt('/')

    const siteNav = await screen.findByRole('navigation', { name: 'Site' })
    expect(siteNav).toHaveClass('flex', 'items-center')
    expect(within(siteNav).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/start')
    expect(within(siteNav).getByRole('link', { name: 'Open Events on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/MoizIbnYousaf/open-events',
    )
    expect(within(siteNav).getByRole('link', { name: 'Open Events on GitHub' })).toHaveAttribute(
      'target',
      '_blank',
    )
    expect(screen.getByRole('link', { name: 'Open Events' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Open Events' })).toBeNull()
  })

  it('names its two public landmarks distinctly so an evaluator is not told the portal is theirs', async () => {
    mountAt('/')

    expect(await screen.findByRole('navigation', { name: 'Speaker' })).toBeInTheDocument()
    const programme = screen.getByRole('navigation', { name: 'Programme' })
    expect(within(programme).getByRole('link', { name: 'Call for papers' })).toHaveAttribute(
      'href',
      `/cfp/${EVENT_SLUG}/${DEFAULT_FORM_SLUG}`,
    )
    expect(within(programme).getByRole('link', { name: 'Public schedule' })).toHaveAttribute(
      'href',
      `/schedule/${EVENT_SLUG}`,
    )
  })

  it('offers no link to a surface with no server behind it', async () => {
    mountAt('/')

    const programme = await screen.findByRole('navigation', { name: 'Programme' })
    expect(
      within(programme)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Call for papers',
      'Public schedule',
      'Sessions',
      'Public speakers',
      'Speaker gallery',
    ])
    // /evaluations has no API handler in this candidate (DEC-016); linking it
    // would put a dead control in the public programme nav.
    expect(screen.queryByRole('link', { name: 'Evaluations' })).toBeNull()
  })

  it('never marks the public sign-in link as the current page inside /admin', async () => {
    mountAt(`/admin/events/${EVENT_SLUG}/submissions`)

    const siteNav = await screen.findByRole('navigation', { name: 'Site' })
    // Link matches by path prefix by default, so /admin would otherwise claim
    // to be the current page on every organizer screen.
    expect(within(siteNav).getByRole('link', { name: 'Sign in' })).not.toHaveAttribute(
      'aria-current',
    )
    const current = Array.from(document.querySelectorAll('[aria-current="page"]')).map(
      (node) => node.textContent,
    )
    expect(current).toEqual(['Submissions'])
  })

  // A back link exists ONLY where the rail cannot reach the origin
  // (`BackLink.tsx`). These two cases are the halves of that rule: a rail
  // destination must not offer a second, contradicting way back, and a surface
  // the rail has no vocabulary for must still offer one.
  it.each([
    ['taxonomies', 'Taxonomies'],
    ['evaluations', 'Review committee'],
  ])('leaves the way back to the rail on the %s rail destination', async (segment, railLabel) => {
    mountAt(`/admin/events/${EVENT_SLUG}/${segment}`)

    // The rail is what marks where the reader is standing, and it lists Event
    // settings as this page's SIBLING. A content-level "Back to event settings"
    // would claim the two are parent and child on the same screen.
    const rail = await screen.findByRole('navigation', { name: 'Event' })
    await waitFor(() =>
      expect(document.querySelector('[aria-current="page"]')?.textContent).toBe(railLabel),
    )
    expect(within(rail).getByRole('link', { name: 'Event settings' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Back to/ })).toBeNull()
  })

  it('keeps the way back on a detail surface the rail cannot reach', async () => {
    mountAt(
      `/admin/events/demo-conf-2026/forms/${PUBLISHED_FORM.formId}/versions/${PUBLISHED_FORM.publishedVersionId}`,
    )

    // No rail row names one version of one form, so the link is the only exit.
    expect(await screen.findByRole('link', { name: 'Back to builder' })).toBeInTheDocument()
  })

  it('does not claim the builder back link is the current page', async () => {
    mountAt(
      `/admin/events/demo-conf-2026/forms/${PUBLISHED_FORM.formId}/versions/${PUBLISHED_FORM.publishedVersionId}`,
    )

    await screen.findByRole('link', { name: 'Back to builder' })
    // The builder path is a strict prefix of this version page and is not an
    // index route, so a prefix-matching Link would announce the way back as
    // the page the organizer is already on.
    const current = Array.from(document.querySelectorAll('[aria-current="page"]')).map(
      (node) => node.textContent,
    )
    expect(current).toEqual([])
  })

  it('shows the shareable public links once a form is published', async () => {
    mountAt(`/admin/events/${EVENT_SLUG}`)

    expect(await screen.findByRole('link', { name: /call for papers/i })).toHaveAttribute(
      'href',
      `/cfp/${EVENT_SLUG}/cfp`,
    )
  })

  it('hides the public links while no form is published', async () => {
    fetchHandler = (url) => {
      if (url === `/api/admin/events/${EVENT_SLUG}/forms`) {
        return jsonResponse([{ ...PUBLISHED_FORM, status: 'draft', publishedVersionId: null }])
      }
      return defaultHandler(url)
    }
    mountAt(`/admin/events/${EVENT_SLUG}`)

    await screen.findByRole('navigation', { name: 'Event' })
    await waitFor(() => expect(screen.queryByText('Public links')).toBeNull())
  })
})

/**
 * A reviewer's queue has to be reachable by clicking.
 *
 * The review queue lived at /evaluations and was linked from nowhere: a signed-in
 * committee member saw the speaker portal, their headshot, the call for papers and
 * the public schedule, and could only reach the work they had been assigned by
 * typing the URL. A capability with no control is, to everyone who is not reading
 * the source, absent.
 */
describe('the reviewer can reach their queue', () => {
  it('offers the review queue among a signed-in speaker’s destinations', () => {
    const destinations = speakerDestinations()
    const reviews = destinations.find((destination) => destination.to === '/evaluations')
    expect(reviews).toBeDefined()
    expect(reviews?.label).toMatch(/review/i)
  })
})
