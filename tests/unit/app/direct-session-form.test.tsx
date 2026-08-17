import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DirectSessionForm from '../../../src/app/features/admin/DirectSessionForm'

const SLUG = 'demo-conf-2026'
let requests: Array<{ url: string; init?: RequestInit }>

beforeEach(() => {
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      requests.push({ url, init })
      if (url.endsWith('/speakers')) {
        return Response.json([{ contactId: 'speaker-1', name: 'Ada', email: 'ada@example.test' }])
      }
      if (url.endsWith('/taxonomies')) {
        return Response.json({
          eventId: 'event-1',
          items: [
            { id: 'format-1', kind: 'format', key: 'talk', label: 'Talk', position: 0 },
            { id: 'track-1', kind: 'track', key: 'ai', label: 'AI', position: 0 },
          ],
        })
      }
      if (url.endsWith('/direct-sessions') && init?.method === 'POST') {
        return Response.json({ submissionId: 'direct-1', created: true }, { status: 201 })
      }
      return Response.json({ error: { code: 'internal', message: 'unexpected' } }, { status: 500 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('DirectSessionForm', () => {
  it('creates an invited session from an existing speaker and taxonomy', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DirectSessionForm eventSlug={SLUG} />
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Add invited session' }))
    await user.selectOptions(await screen.findByLabelText('Speaker'), 'speaker-1')
    await user.type(screen.getByLabelText('Title'), 'Opening keynote')
    await user.type(screen.getByLabelText('Abstract'), 'A guaranteed session.')
    await user.selectOptions(screen.getByLabelText('Format'), 'format-1')
    await user.selectOptions(screen.getByLabelText('Track'), 'track-1')
    await user.click(screen.getByRole('button', { name: 'Create invited session' }))

    expect(
      await screen.findByText('Invited session created and added to the unplaced agenda.'),
    ).toBeInTheDocument()
    const request = requests.find(({ url }) => url.endsWith('/direct-sessions'))
    expect(request?.init?.method).toBe('POST')
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      speakerContactId: 'speaker-1',
      title: 'Opening keynote',
      abstract: 'A guaranteed session.',
      formatId: 'format-1',
      trackId: 'track-1',
      durationMinutes: 45,
    })
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''))
  })
})
