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
import {
  commandActions,
  filterCommandActions,
  groupCommandActions,
} from '../../../src/app/features/command/command-actions'
import { CommandMenu } from '../../../src/app/features/command/CommandMenu'

const ROOT = resolve(import.meta.dirname, '../../..')
const EVENT_SLUG = DEFAULT_EVENT_SLUG

const EVENT_DTO = {
  id: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: EVENT_SLUG,
  name: 'DemoConf 2026',
  timezone: 'Europe/Berlin',
  status: 'draft',
  startsAt: null,
  endsAt: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes(`/api/events/${EVENT_SLUG}`)) return Promise.resolve(jsonResponse(EVENT_DTO))
      return Promise.resolve(jsonResponse({ error: { code: 'internal' } }, 500))
    }),
  )
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
      <CommandMenu
        onNavigate={(action) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          void router.navigate({ to: action.to, params: action.params } as any)
        }
      />
    </ThemeProvider>,
  )
  return { router, user: userEvent.setup() }
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /command menu/i }))
  return screen.findByRole('dialog')
}

describe('command action model', () => {
  it('offers only destinations the visible navigation already exposes', () => {
    const navigable = commandActions().filter((action) => action.kind === 'navigate')
    const fromNav = [
      ...organizerDestinations(EVENT_SLUG),
      ...speakerDestinations(),
      ...publicDestinations(EVENT_SLUG, DEFAULT_FORM_SLUG),
    ]

    expect(navigable.map((action) => action.to).sort()).toEqual(
      fromNav.map((destination) => destination.to).sort(),
    )
    expect(navigable.map((action) => action.label).sort()).toEqual(
      fromNav.map((destination) => destination.label).sort(),
    )
  })

  it('targets only routes the generated route tree declares', () => {
    const generated = readFileSync(resolve(ROOT, 'src/app/routeTree.gen.ts'), 'utf8')
    const block = generated.slice(
      generated.indexOf('export interface FileRoutesByFullPath {'),
      generated.indexOf('export interface FileRoutesByTo {'),
    )
    const declared = new Set(
      Array.from(block.matchAll(/^\s*'([^']+)':/gm), (match) => match[1] ?? ''),
    )

    for (const action of commandActions()) {
      if (action.kind !== 'navigate') continue
      expect(declared.has(action.to)).toBe(true)
    }
  })

  it('carries the three theme preferences as real actions', () => {
    const theme = commandActions().filter((action) => action.kind === 'theme')
    expect(theme.map((action) => action.preference)).toEqual(['system', 'light', 'dark'])
  })

  it('filters case-insensitively across label and group', () => {
    const filtered = filterCommandActions(commandActions(), 'HEADSHOT')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.label).toBe('Your headshot')
    expect(filterCommandActions(commandActions(), 'nothing-matches-this')).toHaveLength(0)
  })

  it('keeps every action inside exactly one group', () => {
    const groups = groupCommandActions(commandActions())
    const flattened = groups.flatMap((group) => group.items)
    expect(flattened).toHaveLength(commandActions().length)
    expect(new Set(groups.map((group) => group.heading)).size).toBe(groups.length)
  })
})

describe('command menu', () => {
  it('offers a visible affordance that names its shortcut', async () => {
    const { user } = mountAt('/')

    const trigger = await screen.findByRole('button', { name: /command menu/i })
    expect(trigger).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('Meta+K'))

    await user.click(trigger)
    expect(await screen.findByRole('dialog')).toHaveAccessibleName(/command menu/i)
  })

  it('opens on Meta+K and on Control+K', async () => {
    const { user } = mountAt('/')
    await screen.findByRole('button', { name: /command menu/i })

    await user.keyboard('{Meta>}k{/Meta}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('clears the query when the chord that opened it also closes it', async () => {
    const { user } = mountAt('/')
    await screen.findByRole('button', { name: /command menu/i })

    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog')
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /search commands/i })).toHaveFocus(),
    )
    await user.keyboard('headsh')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))

    // Closing with the chord is the pure-keyboard path this feature exists
    // for, and it has to leave the palette in the same state Escape does —
    // otherwise the next open is silently pre-filtered by text the user
    // cannot see themselves having typed.
    await user.keyboard('{Meta>}k{/Meta}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog')
    expect(screen.getByRole('combobox', { name: /search commands/i })).toHaveValue('')
    expect(screen.getAllByRole('option').length).toBeGreaterThan(1)
  })

  it('returns focus to the affordance when it closes', async () => {
    const { user } = mountAt('/')
    const trigger = await screen.findByRole('button', { name: /command menu/i })

    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('does not hijack the chord while the organizer is typing in a field', async () => {
    const { user } = mountAt('/admin')

    const secret = await screen.findByLabelText('Organizer secret')
    await user.click(secret)
    await user.keyboard('{Control>}k{/Control}')

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('puts keyboard focus in the search box and filters by typing', async () => {
    const { user } = mountAt('/')
    await openPalette(user)

    const search = screen.getByRole('combobox', { name: /search commands/i })
    await waitFor(() => expect(search).toHaveFocus())

    const options = () => screen.getAllByRole('option').map((option) => option.textContent)
    expect(options()).toEqual(expect.arrayContaining(['Readiness', 'Your headshot']))

    await user.keyboard('headsh')
    await waitFor(() => expect(options()).toEqual(['Your headshot']))
  })

  it('reports an empty result instead of showing nothing at all', async () => {
    const { user } = mountAt('/')
    await openPalette(user)

    await user.keyboard('zzzzz')

    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0))
    expect(screen.getByText(/no commands match/i)).toBeInTheDocument()
  })

  it('moves the active option with the arrow keys and marks it for assistive tech', async () => {
    const { user } = mountAt('/')
    await openPalette(user)

    const search = screen.getByRole('combobox', { name: /search commands/i })
    const first = screen.getAllByRole('option')[0]
    await waitFor(() => expect(search).toHaveAttribute('aria-activedescendant', first?.id ?? ''))
    expect(first).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    const second = screen.getAllByRole('option')[1]
    expect(search).toHaveAttribute('aria-activedescendant', second?.id ?? '')
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(first).toHaveAttribute('aria-selected', 'false')
  })

  it('navigates to a real route on Enter, using the keyboard only', async () => {
    const { router, user } = mountAt('/')
    await screen.findByRole('button', { name: /command menu/i })

    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('dialog')
    await user.keyboard('readiness')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/admin/events/${EVENT_SLUG}/readiness`),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('changes the theme from the palette and says so', async () => {
    const { user } = mountAt('/')
    await openPalette(user)

    await user.keyboard('dark')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })

  it('groups its commands under headings a screen reader can walk', async () => {
    const { user } = mountAt('/')
    const dialog = await openPalette(user)

    const groups = within(dialog).getAllByRole('group')
    expect(groups.length).toBeGreaterThan(1)
    for (const group of groups) {
      expect(group).toHaveAccessibleName()
    }
  })
})
