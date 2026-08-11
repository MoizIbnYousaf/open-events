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

  it('offers every room and slot of the day as a labelled drop target', () => {
    render(<AgendaDndBoard board={BOARD} day="2026-05-13" onPlace={vi.fn()} />)

    expect(screen.getByLabelText('Main hall at 09:00')).toBeInTheDocument()
    expect(screen.getByLabelText('Workshop A at 08:00')).toBeInTheDocument()
  })

  it('offers the slots of the day on the board, not another day’s', () => {
    render(<AgendaDndBoard board={BOARD} day="2026-05-14" onPlace={vi.fn()} />)

    expect(screen.getByLabelText('Main hall at 09:00')).toBeInTheDocument()
    expect(screen.queryByLabelText('Main hall at 08:00')).toBeNull()
    expect(screen.queryByLabelText('Workshop A at 08:00')).toBeNull()
  })
})
