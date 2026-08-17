import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import app from '../../src/server'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import { ALLOWED_ORIGIN, bindings, cookieHeader, loginOrganizer } from './m2c-helpers'

function png(width: number, height: number): ArrayBuffer {
  const bytes = new Uint8Array(64)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes.buffer
}

async function organizerCookie(): Promise<string> {
  const login = await loginOrganizer()
  if (login.token === null) throw new Error('organizer login failed')
  return login.token
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

describe('event branding assets', () => {
  it('stores an event-scoped logo and exposes only its canonical public URL', async () => {
    const organizer = await organizerCookie()
    const stored = await app.request(
      '/api/admin/events/demo-conf-2026/branding/logo',
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'image/png',
        },
        body: png(512, 256),
      },
      bindings(),
    )
    expect(stored.status).toBe(200)
    const storedBody = (await stored.json()) as { url: string }
    expect(storedBody).toMatchObject({
      kind: 'logo',
      width: 512,
      height: 256,
    })
    expect(storedBody.url).toMatch(/^\/api\/public\/events\/demo-conf-2026\/branding\/logo\?v=/)

    const event = await app.request('/api/events/demo-conf-2026', undefined, bindings())
    const eventBody = (await event.json()) as { logoUrl: string; backgroundUrl: null }
    expect(eventBody).toMatchObject({
      backgroundUrl: null,
    })
    expect(eventBody.logoUrl).toMatch(/^\/api\/public\/events\/demo-conf-2026\/branding\/logo\?v=/)
    const publicAsset = await app.request(
      '/api/public/events/demo-conf-2026/branding/logo',
      undefined,
      bindings(),
    )
    expect(publicAsset.status).toBe(200)
    expect(publicAsset.headers.get('content-type')).toContain('image/png')
    expect(publicAsset.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('rejects invalid dimensions, signatures, and cross-event paths without objects', async () => {
    const organizer = await organizerCookie()
    const request = (path: string, body: ArrayBuffer) =>
      app.request(
        path,
        {
          method: 'PUT',
          headers: {
            cookie: cookieHeader(organizer),
            origin: ALLOWED_ORIGIN,
            'content-type': 'image/png',
          },
          body,
        },
        bindings(),
      )

    expect(
      (await request('/api/admin/events/demo-conf-2026/branding/logo', png(32, 32))).status,
    ).toBe(400)
    expect(
      (
        await request(
          '/api/admin/events/demo-conf-2026/branding/background',
          new Uint8Array([1, 2, 3]).buffer,
        )
      ).status,
    ).toBe(400)
    expect(
      (await request('/api/admin/events/missing-event/branding/logo', png(512, 256))).status,
    ).toBe(404)
    expect((await env.FILES.list()).objects).toHaveLength(0)
  })

  it('removes the reference and makes the old public URL unavailable', async () => {
    const organizer = await organizerCookie()
    const path = '/api/admin/events/demo-conf-2026/branding/background'
    await app.request(
      path,
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(organizer),
          origin: ALLOWED_ORIGIN,
          'content-type': 'image/png',
        },
        body: png(1600, 900),
      },
      bindings(),
    )
    const removed = await app.request(
      path,
      {
        method: 'DELETE',
        headers: { cookie: cookieHeader(organizer), origin: ALLOWED_ORIGIN },
      },
      bindings(),
    )
    expect(removed.status).toBe(204)
    expect(
      (
        await app.request(
          '/api/public/events/demo-conf-2026/branding/background',
          undefined,
          bindings(),
        )
      ).status,
    ).toBe(404)
  })
})
