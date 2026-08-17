import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import EventBrandingCard from '../../../src/app/features/admin/EventBrandingCard'

const baseProps = {
  slug: 'demo-conf-2026',
  logoUrl: null,
  logoWidth: null,
  logoHeight: null,
  backgroundUrl: null,
  backgroundWidth: null,
  backgroundHeight: null,
  onChanged: vi.fn(),
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  baseProps.onChanged.mockReset()
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          kind: 'logo',
          contentType: 'image/png',
          width: 512,
          height: 256,
          updatedAt: '2026-08-16T22:00:00.000Z',
          url: '/api/public/events/demo-conf-2026/branding/logo',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('event branding', () => {
  it('shows explicit logo and background fallbacks with bounded file controls', () => {
    render(<EventBrandingCard {...baseProps} />)
    expect(screen.getByText(/default logo treatment/i)).toBeInTheDocument()
    expect(screen.getByText(/default stage artwork/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/event logo/i)).toHaveAttribute(
      'accept',
      expect.stringContaining('image/png'),
    )
    expect(screen.getByLabelText(/event background/i)).toHaveAttribute(
      'accept',
      expect.stringContaining('image/jpeg'),
    )
  })

  it('uploads a selected logo and refreshes the event configuration', async () => {
    render(<EventBrandingCard {...baseProps} />)
    const file = new File(['png'], 'logo.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText(/event logo/i), file)

    await waitFor(() => expect(baseProps.onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/events/demo-conf-2026/branding/logo',
      expect.objectContaining({ method: 'PUT', body: file }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(/logo uploaded/i)
  })

  it('rejects a non-image locally without a request', async () => {
    render(<EventBrandingCard {...baseProps} />)
    await userEvent.upload(
      screen.getByLabelText(/event background/i),
      new File(['x'], 'payload.svg', { type: 'image/svg+xml' }),
      { applyAccept: false },
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/png or jpeg/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('confirms removal and refreshes only after the server succeeds', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <EventBrandingCard
        {...baseProps}
        logoUrl="/api/public/events/demo-conf-2026/branding/logo"
        logoWidth={512}
        logoHeight={256}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /remove logo/i }))
    await waitFor(() => expect(baseProps.onChanged).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/events/demo-conf-2026/branding/logo',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
