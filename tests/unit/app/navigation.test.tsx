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
  if (url === `/api/admin/events/${EVENT_SLUG}/agenda`) return jsonResponse({ sessions: [] })
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
      'Event settings',
      'Taxonomies',
      'Submissions',
      'Readiness',
      'Evaluations',
      'Agenda',
    ])
    for (const destination of organizerDestinations(EVENT_SLUG)) {
      expect(destination.params?.slug).toBe(EVENT_SLUG)
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

  it('offers the organizer sign-in from the site shell without adding a heading', async () => {
    mountAt('/')

    const siteNav = await screen.findByRole('navigation', { name: 'Site' })
    expect(within(siteNav).getByRole('link', { name: 'Organizer sign-in' })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(screen.getByRole('link', { name: 'SpeakerOps' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'SpeakerOps' })).toBeNull()
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
    ).toEqual(['Call for papers', 'Public schedule'])
    // /evaluations has no API handler in this candidate (DEC-016); linking it
    // would put a dead control in the public programme nav.
    expect(screen.queryByRole('link', { name: 'Evaluations' })).toBeNull()
  })

  it('never marks the organizer sign-in link as the current page inside /admin', async () => {
    mountAt(`/admin/events/${EVENT_SLUG}/submissions`)

    const siteNav = await screen.findByRole('navigation', { name: 'Site' })
    // Link matches by path prefix by default, so /admin would otherwise claim
    // to be the current page on every organizer screen.
    expect(within(siteNav).getByRole('link', { name: 'Organizer sign-in' })).not.toHaveAttribute(
      'aria-current',
    )
    const current = Array.from(document.querySelectorAll('[aria-current="page"]')).map(
      (node) => node.textContent,
    )
    expect(current).toEqual(['Submissions'])
  })

  it('does not claim the event settings back link is the current page', async () => {
    mountAt(`/admin/events/${EVENT_SLUG}/taxonomies`)

    await screen.findByRole('link', { name: 'Back to event settings' })
    const current = Array.from(document.querySelectorAll('[aria-current="page"]')).map(
      (node) => node.textContent,
    )
    expect(current).toEqual(['Taxonomies'])
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
