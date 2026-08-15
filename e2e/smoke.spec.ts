import { expect, test } from '@playwright/test'

import { isConsoleNoise } from './helpers/console-noise'

test('app shell loads DemoConf 2026 with no console errors and a healthy API', async ({ page }) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !isConsoleNoise(message.text())) {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  const response = await page.goto('/')
  expect(response?.status()).toBe(200)

  await expect(page.getByText('DemoConf 2026')).toBeVisible()

  const health = await page.request.get('/api/health')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok', build: 'm1', database: { status: 'ok' } })

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
