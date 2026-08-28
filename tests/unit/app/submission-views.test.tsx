import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SubmissionViewDto } from '../../../src/application/dtos/submission-view.dto'
import { SubmissionViews } from '../../../src/app/features/admin/SubmissionViews'
import { createQueryClient } from '../../../src/app/query-client'

const STATE = {
  schemaVersion: 1 as const,
  decision: 'pending' as const,
  routing: 'all',
  sort: 'title-asc' as const,
  facets: [],
}
const VIEW: SubmissionViewDto = {
  eventId: 'event-1',
  id: 'view-1',
  name: 'Needs review',
  state: STATE,
  createdAt: '2026-08-28T12:00:00.000Z',
  updatedAt: '2026-08-28T12:00:00.000Z',
}

let requests: Array<{ url: string; method: string; body: unknown }>

function mount(props: Partial<React.ComponentProps<typeof SubmissionViews>> = {}) {
  const client = createQueryClient()
  const onApply = vi.fn()
  const onDeleted = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <SubmissionViews
        eventSlug="demo-conf-2026"
        activeViewId={undefined}
        currentState={STATE}
        onApply={onApply}
        onDeleted={onDeleted}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onApply, onDeleted }
}

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'
      requests.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (method === 'GET') return Response.json([VIEW])
      if (method === 'POST') return Response.json({ ...VIEW, id: 'view-created' }, { status: 201 })
      if (method === 'DELETE') return Response.json({ deleted: true })
      return Response.json({ error: { code: 'internal', message: 'unexpected' } }, { status: 500 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('SubmissionViews', () => {
  it('lists and applies an event-wide saved view', async () => {
    const user = userEvent.setup()
    const { onApply } = mount()

    const select = await screen.findByRole('combobox', { name: 'Saved submission view' })
    await screen.findByRole('option', { name: 'Needs review' })
    await user.selectOptions(select, 'view-1')
    expect(onApply).toHaveBeenCalledWith(VIEW)
  })

  it('saves only the canonical filter snapshot and applies the created view', async () => {
    const user = userEvent.setup()
    const { onApply } = mount()

    await user.click(screen.getByText('Save current view'))
    await user.type(screen.getByLabelText('View name'), 'My queue')
    await user.click(screen.getByRole('button', { name: 'Save view' }))

    await waitFor(() => expect(requests.some((request) => request.method === 'POST')).toBe(true))
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      name: 'My queue',
      state: STATE,
    })
    expect(onApply).toHaveBeenCalledWith({ ...VIEW, id: 'view-created' })
  })

  it('requires an inline confirmation before deleting the active view', async () => {
    const user = userEvent.setup()
    const { onDeleted } = mount({ activeViewId: 'view-1' })
    await screen.findByRole('combobox', { name: 'Saved submission view' })
    await screen.findByRole('option', { name: 'Needs review' })

    await user.click(screen.getByRole('button', { name: 'Delete saved view' }))
    expect(requests.some((request) => request.method === 'DELETE')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Confirm delete view' }))

    await waitFor(() => expect(requests.some((request) => request.method === 'DELETE')).toBe(true))
    expect(onDeleted).toHaveBeenCalledWith('view-1')
  })

  it('recovers when deletion succeeds remotely but its response is lost', async () => {
    let deletedRemotely = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET') return Response.json(deletedRemotely ? [] : [VIEW])
        if (method === 'DELETE') {
          deletedRemotely = true
          return Response.json(
            { error: { code: 'internal', message: 'The response was interrupted.' } },
            { status: 500 },
          )
        }
        return Response.json(
          { error: { code: 'internal', message: 'unexpected' } },
          { status: 500 },
        )
      }),
    )
    const user = userEvent.setup()
    const { onDeleted } = mount({ activeViewId: 'view-1' })
    await screen.findByRole('option', { name: 'Needs review' })

    await user.click(screen.getByRole('button', { name: 'Delete saved view' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete view' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The response was interrupted.')

    await user.click(screen.getByRole('button', { name: 'Reload saved views' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('view-1'))
    expect(screen.queryByRole('option', { name: 'Needs review' })).not.toBeInTheDocument()
  })
})
