import { expect, test } from '@playwright/test'

import { isConsoleNoise } from './helpers/console-noise'

test('explicit live target is healthy and renders read-only public surfaces', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !isConsoleNoise(message.text())) {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}`))

  const health = await page.request.get('/api/health')
  expect(health.status()).toBe(200)
  const payload = (await health.json()) as Record<string, unknown>
  if (process.env.LIVE_EXPECTED_BUILD !== undefined) {
    expect(payload.build).toBe(process.env.LIVE_EXPECTED_BUILD)
  }
  if (process.env.LIVE_EXPECTED_ENVIRONMENT !== undefined) {
    expect(payload.environment).toBe(process.env.LIVE_EXPECTED_ENVIRONMENT)
  }

  for (const path of [
    '/',
    '/schedule/demo-conf-2026',
    '/sessions/demo-conf-2026',
    '/speakers/demo-conf-2026',
  ]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await expect(page.locator('body')).toBeVisible()
  }
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
  expect(failedRequests).toEqual([])
})
