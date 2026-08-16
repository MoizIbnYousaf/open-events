import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it } from 'vitest'

import AdminLogin from '../../../src/app/features/admin/AdminLogin'
import { PublicStartPage } from '../../../src/app/features/public/PublicStartPage'

/**
 * V7-DOORS / FX-6 m1. The product has two entrances — the organizer door at
 * `/admin` and the speaker door at `/start` — and both source files carry a
 * comment claiming they read as one family. They did not: the cards measured
 * 416px against 448px and the organizer's action ran the full card width while
 * the speaker's sat at its own label width, 115px, floating in a wide row.
 *
 * Both halves were fixed and neither was pinned (RV3 NEW-3): a Tailwind measure
 * token and a `w-full` are exactly the kind of thing that drifts back without a
 * test turning red. jsdom lays nothing out, so the contract asserted here is
 * the one the 448/424 measurement is a consequence of — the same used measure
 * on both cards, and a full-width primary action on both.
 */

/** `max-w-[30rem] px-4` and `max-w-md` both land the card itself at 28rem. */
const ADMIN_MEASURE = 'max-w-[30rem]'
const START_MEASURE = 'max-w-6xl'

afterEach(cleanup)

function renderAdminDoor() {
  const rootRoute = createRootRoute({ component: AdminLogin })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function renderSpeakerDoor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <PublicStartPage />
    </QueryClientProvider>,
  )
}

/** The measure the door's card is laid inside, read off the column it sits in. */
function columnClasses(card: Element | null): readonly string[] {
  const column = card?.parentElement
  expect(column).not.toBeNull()
  return (column?.className ?? '').split(/\s+/)
}

describe('the two doors', () => {
  it('lays the organizer door out at the measure the speaker door already used', async () => {
    renderAdminDoor()

    const card = (await screen.findByText('Admin sign in')).closest('[data-slot="card"]')
    expect(card).not.toBeNull()
    const classes = columnClasses(card)
    expect(classes).toContain(ADMIN_MEASURE)
    // The gutter is INSIDE the measure, which is what lands the card at the
    // speaker door's 28rem rather than 2rem wider than it.
    expect(classes).toContain('px-4')
  })

  it('gives unified access room for role guidance and the email form', () => {
    renderSpeakerDoor()

    const card = screen.getByText('Speaker access').closest('[data-slot="card"]')
    expect(card).not.toBeNull()
    expect(columnClasses(card)).toContain(START_MEASURE)
    expect(columnClasses(card)).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.82fr)]')
  })

  it('gives both doors one full-width primary action', async () => {
    renderAdminDoor()
    expect(await screen.findByRole('button', { name: 'Sign in' })).toHaveClass('w-full')
    cleanup()

    renderSpeakerDoor()
    expect(screen.getByRole('button', { name: 'Request a link' })).toHaveClass('w-full')
  })

  it('uses one page heading and one subordinate speaker heading', () => {
    renderSpeakerDoor()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Access your workspace' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Speaker access' })).toBeInTheDocument()
  })
})
