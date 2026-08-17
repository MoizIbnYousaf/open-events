import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import CalendarActions from '../../../src/app/features/public/CalendarActions'

const EVENT = {
  uid: 'session-1@open-events',
  title: 'Agents & APIs',
  start: '2026-05-13T09:00:00.000Z',
  end: '2026-05-13T10:00:00.000Z',
  location: 'Main hall',
  description: 'A practical session.',
}

describe('CalendarActions', () => {
  it('offers descriptive provider links and the canonical calendar download', () => {
    render(<CalendarActions event={EVENT} icsHref="/session-1.ics" />)

    const group = screen.getByRole('group', { name: 'Add Agents & APIs to calendar' })
    const google = screen.getByRole('link', { name: 'Add to Google Calendar' })
    const outlook = screen.getByRole('link', { name: 'Add to Outlook' })
    const ics = screen.getByRole('link', { name: 'Download iCalendar file' })

    expect(group).toContainElement(google)
    expect(group).toContainElement(outlook)
    expect(group).toContainElement(ics)
    expect(google).toHaveAttribute('target', '_blank')
    expect(google).toHaveAttribute('rel', 'noopener noreferrer')
    expect(new URL(google.getAttribute('href') ?? '').hostname).toBe('calendar.google.com')
    expect(new URL(outlook.getAttribute('href') ?? '').hostname).toBe('outlook.live.com')
    expect(ics).toHaveAttribute('href', '/session-1.ics')
    expect(ics).toHaveAttribute('download')
  })
})
