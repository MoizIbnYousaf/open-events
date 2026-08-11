import { expect, test } from '@playwright/test'

test('event-config builder link exposes a >= 24x24px hit area', async ({ page }) => {
  const secret = process.env.LOCAL_ADMIN_TOKEN
  expect(secret, 'set LOCAL_ADMIN_TOKEN to run the local organizer proof').toBeTruthy()

  const session = await page.request.post('/api/admin/session', { data: { secret } })
  expect(session.status()).toBe(200)
  expect(session.headers()['content-type'] ?? '').toContain('application/json')

  const response = await page.goto('/admin/events/demo-conf-2026')
  expect(response?.status()).toBe(200)

  const builderLink = page.getByRole('link', { name: 'cfp', exact: true })
  await expect(builderLink).toBeVisible()
  await expect(builderLink).toHaveAttribute(
    'href',
    '/admin/events/demo-conf-2026/forms/f0000000-0000-4000-8000-000000000001',
  )

  const box = await builderLink.boundingBox()
  console.log('B2-E2E-BOUNDING-BOX', JSON.stringify(box))
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(24)
  expect(box!.height).toBeGreaterThanOrEqual(24)
})
