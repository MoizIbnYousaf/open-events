import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../../../src/app/query-client'
import EvaluationsPage from '../../../src/app/features/public/EvaluationsPage'

/**
 * The reviewer's form, when the round has questions of its own.
 *
 * A scorecard only the organizer can see is a settings screen, not a review
 * process — the questions have to render for the person answering them, keep
 * what they enter, and show it again when they come back.
 */

const EVALUATIONS_PATH = '/api/public/evaluations'

interface RowCriterion {
  id: string
  label: string
  kind: 'rating' | 'select' | 'text'
  weight: number | null
  scale: { min: number; max: number } | null
  options: string[] | null
  value: number | string | null
}

const CRITERIA: RowCriterion[] = [
  {
    id: 'c-rating',
    label: 'Relevance',
    kind: 'rating',
    weight: 3,
    scale: { min: 1, max: 5 },
    options: null,
    value: null,
  },
  {
    id: 'c-select',
    label: 'Suggested track',
    kind: 'select',
    weight: null,
    scale: null,
    options: ['Platform & Infra', 'AI Engineering'],
    value: null,
  },
  {
    id: 'c-text',
    label: 'Notes for the speaker',
    kind: 'text',
    weight: null,
    scale: null,
    options: null,
    value: null,
  },
]

function typedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    submissionId: 'submission-1',
    sessionTitle: 'Taming 40-Minute CI',
    roundId: 'round-1',
    roundNumber: 1,
    roundName: 'Round 1',
    roundStatus: 'open',
    rating: null,
    comments: null,
    updatedAt: null,
    previousRounds: [],
    criteria: CRITERIA,
    ...overrides,
  }
}

let rows: Record<string, unknown>[]
let fetchMock: ReturnType<typeof vi.fn>
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

function postedBody(): Record<string, unknown> | null {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  const init = call?.[1] as RequestInit | undefined
  return init?.body === undefined
    ? null
    : (JSON.parse(String(init.body)) as Record<string, unknown>)
}

function defaultHandler(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET'
  if (method === 'GET' && url === EVALUATIONS_PATH) return jsonResponse(rows)
  if (method === 'POST' && url === EVALUATIONS_PATH) {
    const sent = JSON.parse(String(init?.body)) as {
      answers?: { criterionId: string; value: unknown }[]
    }
    const byId = new Map((sent.answers ?? []).map((answer) => [answer.criterionId, answer.value]))
    rows = [
      typedRow({
        criteria: CRITERIA.map((criterion) => ({
          ...criterion,
          value: byId.get(criterion.id) ?? criterion.value,
        })),
      }),
    ]
    return jsonResponse(rows[0])
  }
  return jsonResponse({ error: { code: 'internal', message: 'unexpected fetch' } }, 500)
}

function mountQueue() {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <EvaluationsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  rows = [typedRow()]
  fetchHandler = defaultHandler
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    fetchHandler(requestUrl(input), init),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('a reviewer answers the round scorecard', () => {
  it('renders one control per question, of the right kind', async () => {
    mountQueue()

    // A rating is a number on its scale, a choice is a list of the options the
    // organizer set, and prose is a box. Rendering all three as one text field
    // would satisfy "the value round-trips" and satisfy nobody using it.
    expect(await screen.findByLabelText(/Relevance/i)).toBeInTheDocument()
    const track = screen.getByLabelText(/Suggested track/i)
    expect(track.tagName).toBe('SELECT')
    expect(within(track).getByRole('option', { name: 'AI Engineering' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Notes for the speaker/i).tagName).toBe('TEXTAREA')
  })

  it('sends every answer under its own question', async () => {
    const user = userEvent.setup()
    mountQueue()

    await user.selectOptions(await screen.findByLabelText(/Relevance/i), '5')
    await user.selectOptions(screen.getByLabelText(/Suggested track/i), 'AI Engineering')
    await user.type(screen.getByLabelText(/Notes for the speaker/i), 'Tighten the middle third.')
    await user.click(screen.getByRole('button', { name: /save review/i }))

    await waitFor(() => {
      const sent = postedBody() as { answers?: { criterionId: string; value: unknown }[] } | null
      expect(sent?.answers).toEqual([
        { criterionId: 'c-rating', value: 5 },
        { criterionId: 'c-select', value: 'AI Engineering' },
        { criterionId: 'c-text', value: 'Tighten the middle third.' },
      ])
    })
  })

  it('shows the stored answers again when the reviewer returns', async () => {
    rows = [
      typedRow({
        criteria: [
          { ...CRITERIA[0], value: 4 },
          { ...CRITERIA[1], value: 'Platform & Infra' },
          { ...CRITERIA[2], value: 'Already said this.' },
        ],
      }),
    ]
    mountQueue()

    expect(await screen.findByLabelText(/Relevance/i)).toHaveValue('4')
    expect(screen.getByLabelText(/Suggested track/i)).toHaveValue('Platform & Infra')
    expect(screen.getByLabelText(/Notes for the speaker/i)).toHaveValue('Already said this.')
  })

  /** A round with no scorecard keeps the single rating it always had. */
  it('falls back to the plain rating when the round carries no questions', async () => {
    rows = [typedRow({ criteria: undefined })]
    mountQueue()

    await screen.findByText('Taming 40-Minute CI')
    expect(screen.queryByLabelText(/Suggested track/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/rating/i)).toBeInTheDocument()
  })

  /**
   * Blind review means the reviewer does not know whose proposal they are
   * holding. The flag is per round because a committee commonly reads blind
   * first and discusses openly afterwards — and a setting that persists and
   * reloads while changing nothing a reviewer sees is a setting that does not
   * exist.
   */
  it('names the speaker in an open round', async () => {
    rows = [typedRow({ speakerName: 'Ada Lovelace', anonymized: false })]
    mountQueue()

    expect(await screen.findByText(/Ada Lovelace/)).toBeInTheDocument()
  })

  it('withholds the speaker in a blind round, and says that it is blind', async () => {
    rows = [typedRow({ speakerName: null, anonymized: true })]
    mountQueue()

    await screen.findByText('Taming 40-Minute CI')
    expect(screen.queryByText(/Ada Lovelace/)).not.toBeInTheDocument()
    // Said out loud: a reviewer who cannot see a name should know that is the
    // rule rather than assume the data is missing.
    expect(screen.getByText(/blind review/i)).toBeInTheDocument()
  })

  it('says so when the server refuses an answer', async () => {
    const user = userEvent.setup()
    fetchHandler = (url, init) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ error: { code: 'validation_failed', message: 'no' } }, 400)
      }
      return defaultHandler(url, init)
    }
    mountQueue()

    await user.selectOptions(await screen.findByLabelText(/Relevance/i), '5')
    await user.click(screen.getByRole('button', { name: /save review/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
