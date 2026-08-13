import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FormVersionContent } from '../../../src/domain'
import { createQueryClient } from '../../../src/app/query-client'
import CommunicationsPanel from '../../../src/app/features/admin/CommunicationsPanel'
import PreviewEngine from '../../../src/app/features/builder/preview-engine'

const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const VERSION_ID = 'f0000000-0000-4000-8000-000000000002'
const SUBMISSION_ID = 'b1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'

const CONTENT: FormVersionContent = {
  pages: [
    {
      id: 'p-1',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      position: 0,
      kind: 'welcome',
      title: 'Welcome',
      content: '',
    },
  ],
  elements: [
    {
      id: 'e-1',
      eventId: EVENT_ID,
      versionId: VERSION_ID,
      pageId: 'p-1',
      position: 0,
      kind: 'question',
      fieldKey: 'title',
      label: 'Title',
      required: true,
      maxLength: null,
      questionType: 'short_text',
      options: [],
      optionsSource: null,
    },
  ],
  conditionRules: [],
  routingRules: [],
}

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

beforeEach(() => {
  fetchHandler = () => jsonResponse({ error: { code: 'internal', message: 'unexpected' } }, 500)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      fetchHandler(requestUrl(input), init),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('builder preview outcome', () => {
  it('says the answers passed from a region that was already mounted', async () => {
    const user = userEvent.setup()
    render(<PreviewEngine content={CONTENT} taxonomyItems={[]} />)

    // The region waits in the accessibility tree before the check runs: one
    // created together with its text announces nothing (DEC-014).
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')

    await user.type(screen.getByLabelText('Title'), 'A talk')
    await user.click(screen.getByRole('button', { name: /submit preview/i }))

    await waitFor(() => expect(region).toHaveTextContent(/no problems|passed/i))
    expect(screen.getByRole('status')).toBe(region)
  })

  it('replaces the pass message with the problem when the answers stop being valid', async () => {
    const user = userEvent.setup()
    render(<PreviewEngine content={CONTENT} taxonomyItems={[]} />)

    const region = screen.getByRole('status')
    await user.type(screen.getByLabelText('Title'), 'A talk')
    await user.click(screen.getByRole('button', { name: /submit preview/i }))
    await waitFor(() => expect(region).toHaveTextContent(/no problems|passed/i))

    await user.clear(screen.getByLabelText('Title'))
    await user.click(screen.getByRole('button', { name: /submit preview/i }))

    // Silent, not gone: the same region stays mounted so the next pass can be
    // announced from inside the tree.
    expect(screen.getByRole('status')).toBe(region)
    expect(region).toHaveTextContent('')
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

describe('acceptance panel loading region', () => {
  it('keeps its status region in the document once loading finishes', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    fetchHandler = async (url) => {
      await gate
      if (
        url === `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/acceptance-preview`
      ) {
        return jsonResponse({
          toEmail: 'speaker@example.test',
          subject: 'Accepted',
          body: 'Congratulations',
          accepted: false,
        })
      }
      if (url === `/api/admin/events/demo-conf-2026/submissions/${SUBMISSION_ID}/messages`)
        return jsonResponse([])
      return jsonResponse({ error: { code: 'internal', message: 'unexpected' } }, 500)
    }
    const { container } = render(
      <QueryClientProvider client={createQueryClient()}>
        <CommunicationsPanel slug="demo-conf-2026" submissionId={SUBMISSION_ID} />
      </QueryClientProvider>,
    )

    const section = container.querySelector('section') as HTMLElement
    const region = within(section).getByRole('status')
    expect(region).toHaveTextContent(/loading acceptance communications/i)

    release()
    await screen.findByText('Accepted')

    // The same node, still mounted: a live region has to be in the
    // accessibility tree before its text changes, and this one used to be
    // created and destroyed along with its message.
    expect(region.isConnected).toBe(true)
    await waitFor(() => expect(region).toHaveTextContent(''))
  })
})
