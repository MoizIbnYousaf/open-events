import '@testing-library/jest-dom/vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import { MAX_VISIBLE_TOASTS, TOAST_DURATION_MS, Toaster } from '../../../src/components/ui/sonner'
import { clearAnnouncements } from '../../../src/app/lib/announcer'
import { createQueryClient } from '../../../src/app/query-client'
import { ThemeProvider } from '../../../src/components/ui/theme-provider'
import { routeTree } from '../../../src/app/routeTree.gen'
import TasksPanel from '../../../src/app/features/public/TasksPanel'

const ROOT = resolve(import.meta.dirname, '../../..')

const TASKS_URL = '/api/public/tasks'
const COMPLETE_URL = '/api/public/tasks/task-1/complete'
const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'

const TASK = {
  id: 'task-1',
  eventId: EVENT_ID,
  submissionId: 'submission-1',
  submissionTitle: 'My talk',
  contactId: 'contact-1',
  kind: 'submit_headshot',
  status: 'pending',
  position: 0,
  createdAt: '2026-05-01T08:00:00.000Z',
  completedAt: null,
} as const

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function Trigger({ messages }: { readonly messages: readonly string[] }) {
  return (
    <button
      type="button"
      onClick={() => {
        for (const message of messages) toast.success(message)
      }}
    >
      Fire
    </button>
  )
}

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory).sort()) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) walk(full, files)
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) files.push(full)
  }
  return files
}

function notifications(): HTMLElement {
  return screen.getByRole('region', { name: /notifications/i })
}

/** Only the cards the stack actually shows — sonner keeps the overflow mounted. */
function visibleCards(): readonly HTMLElement[] {
  return Array.from(
    notifications().querySelectorAll('li[data-sonner-toast][data-visible="true"]'),
  ).filter((node): node is HTMLElement => node instanceof HTMLElement)
}

afterEach(() => {
  toast.dismiss()
  clearAnnouncements()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  cleanup()
})

describe('toast surface', () => {
  it('mounts one notification region in the app root shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ error: { code: 'not_found' } }, 404))),
    )
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    // The same composition src/main.tsx renders: the toaster is a sibling of
    // the router inside the theme provider, so no route has to carry its own
    // overlay and none of them can take it down. shell-contract.test.tsx pins
    // that source, so this mirror cannot drift from the real shell unnoticed.
    render(
      <ThemeProvider>
        <QueryClientProvider client={createQueryClient()}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <RouterProvider router={router as any} />
        </QueryClientProvider>
        <Toaster />
      </ThemeProvider>,
    )

    const regions = await screen.findAllByRole('region', { name: /notifications/i })
    expect(regions).toHaveLength(1)
  })

  it('shows the outcome and offers a way to dismiss it', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Trigger messages={['Acceptance sent']} />
        <Toaster />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Fire' }))

    expect(await screen.findByText('Acceptance sent')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dismiss notification/i }))
    await waitFor(() => expect(screen.queryByText('Acceptance sent')).toBeNull())
  })

  it('keeps the keyboard user where they were when the card is dismissed', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Trigger messages={['Acceptance sent']} />
        <button type="button">Next control</button>
        <Toaster />
      </>,
    )

    const fire = screen.getByRole('button', { name: 'Fire' })
    await user.click(fire)
    const dismiss = await screen.findByRole('button', { name: /dismiss notification/i })
    dismiss.focus()
    expect(dismiss).toHaveFocus()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByText('Acceptance sent')).toBeNull())

    // Dismissing removes the focused control. If nothing takes focus it falls
    // to <body>, the next Tab restarts at the top of the document, and the
    // user has lost their place (WCAG 2.4.3).
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    expect(fire).toHaveFocus()
  })

  it('auto-dismisses after enough time to read it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <>
        <Trigger messages={['Version 3 published']} />
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fire' }))
    await waitFor(() => expect(screen.getByText('Version 3 published')).toBeInTheDocument())

    // Long enough that a message is readable rather than a flash.
    expect(TOAST_DURATION_MS).toBeGreaterThanOrEqual(6000)
    await act(async () => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 1000)
    })
    await waitFor(() => expect(screen.queryByText('Version 3 published')).toBeNull())
  })

  it('never lets the stack grow far enough to cover the surface', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Trigger messages={['One', 'Two', 'Three', 'Four']} />
        <Toaster />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Fire' }))

    await waitFor(() => expect(visibleCards().length).toBeGreaterThan(0))
    expect(visibleCards().length).toBeLessThanOrEqual(MAX_VISIBLE_TOASTS)
    // Every card the stack shows can be dismissed on its own.
    for (const card of visibleCards()) {
      expect(
        within(card).getByRole('button', { name: /dismiss notification/i }),
      ).toBeInTheDocument()
    }
    expect(visibleCards().map((card) => card.textContent ?? '')).toContainEqual(
      expect.stringContaining('Four'),
    )
  })

  it('announces from a region that was already mounted, and adds no second status node', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Trigger messages={['Headshot updated']} />
        <Toaster />
      </>,
    )

    // In the accessibility tree BEFORE the outcome exists: a live region
    // created together with its text is not reliably announced.
    const region = notifications()
    expect(region).toHaveAttribute('aria-live', 'polite')

    await user.click(screen.getByRole('button', { name: 'Fire' }))
    await waitFor(() => expect(region).toHaveTextContent('Headshot updated'))

    // One live region per outcome (DEC-014): the card must not also be a
    // page-global role=status, or every surface's own status region becomes
    // ambiguous and assistive tech says the sentence twice.
    expect(screen.queryAllByRole('status')).toHaveLength(0)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('respects a reduced-motion preference', () => {
    const source = readFileSync(resolve(ROOT, 'node_modules/sonner/dist/styles.css'), 'utf8')
    expect(source).toContain('prefers-reduced-motion')
  })
})

describe('toast dispatch sites', () => {
  it('retires the in-house toast runtime rather than running two of them', () => {
    expect(existsSync(resolve(ROOT, 'src/components/ui/toast.tsx'))).toBe(false)
    const stragglers = walk(resolve(ROOT, 'src')).filter((file) =>
      /from '[^']*\/ui\/toast'/.test(readFileSync(file, 'utf8')),
    )
    expect(stragglers).toEqual([])
  })

  it('is wired to real outcomes rather than mounted empty', () => {
    const callers = walk(resolve(ROOT, 'src/app')).filter((file) =>
      /from 'sonner'/.test(readFileSync(file, 'utf8')),
    )
    expect(callers.length).toBeGreaterThanOrEqual(4)
  })

  it('reports a completed task without removing the durable record', async () => {
    let completed = false
    const completedTask = { ...TASK, status: 'completed', completedAt: '2026-05-02T09:00:00.000Z' }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input as Request).url
        if (url === COMPLETE_URL && init?.method === 'POST') {
          completed = true
          return Promise.resolve(jsonResponse(completedTask))
        }
        if (url === TASKS_URL) {
          return Promise.resolve(jsonResponse([completed ? completedTask : TASK]))
        }
        return Promise.resolve(jsonResponse({ error: { code: 'internal' } }, 500))
      }),
    )
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TasksPanel />
        <Toaster />
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: /mark complete/i }))

    await waitFor(() =>
      expect(notifications()).toHaveTextContent(/upload your headshot marked complete/i),
    )
    // The transient card is additional, never the only record: the row itself
    // still says the task is complete.
    await waitFor(() => expect(screen.getByText('Complete')).toBeInTheDocument())
  })
})
