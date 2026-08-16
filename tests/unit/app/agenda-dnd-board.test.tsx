import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgendaBoardDto, AgendaSessionDto } from '../../../src/application'
import AgendaDndBoard from '../../../src/app/features/admin/AgendaDndBoard'

// The drag board is an offered keyboard path (dnd-kit's KeyboardSensor is
// registered), so what it says while a session is picked up is part of the
// contract: a screen reader must hear the session title, never the submission
// id dnd-kit's own defaults would read out.

const ROOM_MAIN = { id: 'tax-room-main-hall', key: 'main-hall', label: 'Main hall' }
const ROOM_WORKSHOP = { id: 'tax-room-workshop-a', key: 'workshop-a', label: 'Workshop A' }
const TRACK_TALKS = { id: 'tax-track-talks', key: 'talks', label: 'Talks' }
const SUBMISSION_ID = '0f3a1c7e-9b2d-4f61-8a03-6d5c4b3a2e10'

const UNPLACED: AgendaSessionDto = {
  submissionId: SUBMISSION_ID,
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
  status: 'published',
  assignment: 'scheduled',
}

/** A real-length conference title: 86 characters, no line to break on. */
const LONG_TITLE =
  'Designing for the dark: a visual coherence talk across every organizer surface we ship'

const LONG_UNPLACED: AgendaSessionDto = {
  ...UNPLACED,
  submissionId: 'b7c1d2e3-4f56-4a7b-8c9d-0e1f2a3b4c5d',
  title: LONG_TITLE,
}

const BOARD: AgendaBoardDto = {
  eventId: 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
  slug: 'demo-conf-2026',
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

afterEach(cleanup)

describe('agenda drag board', () => {
  it('announces the picked-up session by title, never by its submission id', async () => {
    const user = userEvent.setup()
    render(<AgendaDndBoard board={BOARD} day="2026-05-13" onPlace={vi.fn()} />)

    const chip = screen.getByRole('button', { name: UNPLACED.title })
    chip.focus()
    await user.keyboard(' ')

    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain('Picked up Scaling Postgres.')
    })
    expect(document.body.textContent ?? '').not.toContain(SUBMISSION_ID)
  })

  // A phone measured the board at 631px inside a 390px window because one
  // unplaced session had an 86-character title: the row of chips is a grid
  // item, so its automatic minimum size was the widest title it held and the
  // chip's own `truncate` could never fire. jsdom lays nothing out, so the
  // contract that survives here is the class pair the measurement depends on —
  // the floor on the row, the clip on the chip.
  it('keeps a long unplaced title inside the board instead of widening the page', () => {
    render(
      <AgendaDndBoard
        board={{ ...BOARD, sessions: [LONG_UNPLACED] }}
        day="2026-05-13"
        onPlace={vi.fn()}
      />,
    )

    const chip = screen.getByRole('button', { name: LONG_TITLE })
    const chipClasses = chip.className.split(/\s+/)
    expect(chipClasses).toContain('truncate')
    expect(chipClasses).toContain('max-w-full')

    const row = chip.parentElement
    expect(row).not.toBeNull()
    expect(row?.className.split(/\s+/)).toContain('min-w-0')
  })

  it('offers every room and slot of the day as a labelled drop target', () => {
    render(<AgendaDndBoard board={BOARD} day="2026-05-13" onPlace={vi.fn()} />)

    expect(screen.getByLabelText('Main hall at 09:00')).toBeInTheDocument()
    expect(screen.getByLabelText('Workshop A at 08:00')).toBeInTheDocument()
  })

  // TA4-P3: the grid's frame is drawn by the element that scrolls. Wrapped in
  // an `overflow-hidden` box, the scroll container's own focus ring — an
  // outward shadow on a real tab stop — was clipped away entirely.
  it('frames the scroller itself, so nothing clips its focus ring', () => {
    const { container } = render(
      <AgendaDndBoard board={BOARD} day="2026-05-13" onPlace={vi.fn()} />,
    )

    const scroller = container.querySelector('[data-slot="table-container"]')
    expect(scroller).toHaveClass('ring-1', 'ring-border', 'rounded-lg')
    expect(scroller).toHaveClass('focus-visible:ring-2')
    expect(scroller).toHaveClass('max-h-[38rem]', 'overflow-y-auto')
    expect(scroller).toHaveAttribute('tabindex', '0')
    expect(scroller?.parentElement?.className ?? '').not.toContain('overflow-hidden')
    // The caption override still lands on the table, not on the new frame.
    expect(container.querySelector('[data-slot="table"]')).toHaveClass('caption-top')
  })

  it('offers the slots of the day on the board, not another day’s', () => {
    render(<AgendaDndBoard board={BOARD} day="2026-05-14" onPlace={vi.fn()} />)

    expect(screen.getByLabelText('Main hall at 09:00')).toBeInTheDocument()
    expect(screen.queryByLabelText('Main hall at 08:00')).toBeNull()
    expect(screen.queryByLabelText('Workshop A at 08:00')).toBeNull()
  })

  it('keeps the calendar rails visible and gives scheduled sessions useful visual context', () => {
    const { container } = render(
      <AgendaDndBoard
        board={{ ...BOARD, sessions: [PLACED] }}
        day="2026-05-13"
        onPlace={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-slot="table-header"]')).toHaveAttribute('data-sticky')
    expect(screen.getByRole('columnheader', { name: 'Time' })).toHaveAttribute('data-pinned')
    expect(screen.getByRole('rowheader', { name: '09:00' })).toHaveAttribute('data-pinned')

    const session = screen.getByRole('button', { name: PLACED.title })
    expect(session).toHaveTextContent('09:00–10:00')
    expect(session).toHaveTextContent(TRACK_TALKS.label)
    expect(
      screen.getByRole('button', { name: `View details for ${PLACED.title}` }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('opens and closes an inline session detail without leaving the board', async () => {
    const user = userEvent.setup()
    render(
      <AgendaDndBoard
        board={{ ...BOARD, sessions: [PLACED] }}
        day="2026-05-13"
        onPlace={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: `View details for ${PLACED.title}` }))

    const details = screen.getByRole('region', { name: 'Selected session details' })
    expect(details).toHaveTextContent(PLACED.title)
    expect(details).toHaveTextContent('Main hall')
    expect(details).toHaveTextContent('Published')
    expect(
      screen.getByRole('button', { name: `View details for ${PLACED.title}` }),
    ).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Close details' }))
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Selected session details' })).toBeNull()
    })
  })
})
