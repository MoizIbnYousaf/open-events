import { expect, type Page } from '@playwright/test'

import { isConsoleNoise } from './console-noise'

export interface TourObserver {
  readonly accessStarts: () => number
  readonly assertClean: () => void
}

export function observeTour(page: Page): TourObserver {
  const browserMessages: string[] = []
  const pageErrors: string[] = []
  const requestFailures: string[] = []
  const httpErrors: string[] = []
  let starts = 0

  page.on('console', (message) => {
    if (
      (message.type() === 'warning' || message.type() === 'error') &&
      !isConsoleNoise(message.text())
    ) {
      browserMessages.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'unknown'
    // TanStack route changes cancel superseded query reads, and browsers report
    // the cancellation as ERR_ABORTED/NS_BINDING_ABORTED or WebKit's literal
    // `cancelled`. It is expected only
    // for this exact browser cancellation code; every transport failure stays visible.
    if (
      errorText === 'net::ERR_ABORTED' ||
      errorText === 'NS_BINDING_ABORTED' ||
      errorText === 'cancelled'
    ) {
      return
    }
    requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${errorText}`)
  })
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/tour/session') {
      starts += 1
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const url = new URL(response.url())
      httpErrors.push(`${response.status()} ${url.pathname}${url.search}`)
    }
  })

  return {
    accessStarts: () => starts,
    assertClean: () => {
      expect(browserMessages).toEqual([])
      expect(pageErrors).toEqual([])
      expect(requestFailures).toEqual([])
      expect(httpErrors).toEqual([])
    },
  }
}
