import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import app from '../../src/server'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  submitterCookie,
} from './m2c-helpers'
import { createSha256TokenHasher } from '../../src/application'

const ADMIN_PATH = '/api/admin/events/demo-conf-2026/resources'
const PUBLIC_PATH = '/api/public/resources'
const hasher = createSha256TokenHasher()

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function organizer(): Promise<string> {
  const result = await loginOrganizer()
  if (result.token === null) throw new Error('organizer login failed')
  return result.token
}

async function portal(): Promise<string> {
  const token = await submitterCookie(env.DB)
  await env.DB.prepare("UPDATE sessions SET capability = 'portal' WHERE token_hash = ?")
    .bind(await hasher.hash(token))
    .run()
  return token
}

async function adminRequest(
  token: string,
  method: string,
  path = ADMIN_PATH,
  body?: unknown,
): Promise<Response> {
  return app.request(
    path,
    {
      method,
      headers: {
        cookie: cookieHeader(token),
        origin: ALLOWED_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  )
}

describe('portal resources', () => {
  it('lets organizers manage ordered resources and speakers see published rows only', async () => {
    const admin = await organizer()
    const first = await adminRequest(admin, 'POST', ADMIN_PATH, {
      kind: 'markdown',
      title: 'Speaker guide',
      body: '# Welcome',
      published: true,
    })
    const second = await adminRequest(admin, 'POST', ADMIN_PATH, {
      kind: 'link',
      title: 'Venue map',
      url: 'https://example.com/map',
      published: false,
    })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const firstBody = (await first.json()) as { id: string }
    const secondBody = (await second.json()) as { id: string }

    const speaker = await portal()
    const visible = await app.request(
      PUBLIC_PATH,
      { headers: { cookie: cookieHeader(speaker) } },
      bindings(),
    )
    expect(visible.status).toBe(200)
    expect(await visible.json()).toMatchObject([{ id: firstBody.id, title: 'Speaker guide' }])

    const published = await adminRequest(admin, 'PATCH', `${ADMIN_PATH}/${secondBody.id}`, {
      kind: 'link',
      title: 'Venue map',
      url: 'https://example.com/map',
      published: true,
    })
    expect(published.status).toBe(200)
    const reordered = await adminRequest(admin, 'POST', `${ADMIN_PATH}/reorder`, {
      ids: [secondBody.id, firstBody.id],
    })
    expect(reordered.status).toBe(200)

    const ordered = await app.request(
      PUBLIC_PATH,
      { headers: { cookie: cookieHeader(speaker) } },
      bindings(),
    )
    expect((await ordered.json()) as Array<{ id: string }>).toMatchObject([
      { id: secondBody.id },
      { id: firstBody.id },
    ])

    const removed = await adminRequest(admin, 'DELETE', `${ADMIN_PATH}/${secondBody.id}`)
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ deleted: true })
    const afterDelete = await app.request(
      PUBLIC_PATH,
      { headers: { cookie: cookieHeader(speaker) } },
      bindings(),
    )
    expect(await afterDelete.json()).toMatchObject([{ id: firstBody.id }])
  })

  it('denies unsafe input, wrong capabilities, cross-event ids, and tour mutation', async () => {
    const admin = await organizer()
    const unsafe = await adminRequest(admin, 'POST', ADMIN_PATH, {
      kind: 'link',
      title: 'Unsafe',
      url: 'javascript:alert(1)',
      published: true,
    })
    expect(unsafe.status).toBe(400)

    const cfp = await submitterCookie(env.DB)
    const wrongCapability = await app.request(
      PUBLIC_PATH,
      { headers: { cookie: cookieHeader(cfp) } },
      bindings(),
    )
    expect(wrongCapability.status).toBe(403)

    const tour = await app.request(
      '/api/tour/session',
      {
        method: 'POST',
        headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ access: 'organizer' }),
      },
      bindings(),
    )
    const cookie = tour.headers.get('set-cookie')?.match(/sp_tour_session=([^;]+)/)?.[1]
    expect(cookie).toBeTruthy()
    const denied = await app.request(
      ADMIN_PATH,
      {
        method: 'POST',
        headers: {
          cookie: `sp_tour_session=${cookie ?? ''}`,
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'markdown',
          title: 'No write',
          body: 'No write',
          published: true,
        }),
      },
      bindings(),
    )
    expect(denied.status).toBe(403)
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM portal_resources').first<{
      n: number
    }>()
    expect(count?.n).toBe(0)
  })

  it('does not update another event resource and rejects a stale reorder set', async () => {
    const admin = await organizer()
    const created = await adminRequest(admin, 'POST', ADMIN_PATH, {
      kind: 'markdown',
      title: 'Speaker guide',
      body: 'Guide',
      published: true,
    })
    const resource = (await created.json()) as { id: string }
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
       VALUES ('event-other', 'other-conf', 'Other Conf', 'UTC', 'draft', NULL, NULL)`,
    ).run()

    const crossEvent = await adminRequest(
      admin,
      'PATCH',
      `/api/admin/events/other-conf/resources/${resource.id}`,
      { kind: 'markdown', title: 'Changed', body: 'Changed', published: true },
    )
    expect(crossEvent.status).toBe(404)

    const stale = await adminRequest(admin, 'POST', `${ADMIN_PATH}/reorder`, { ids: [] })
    expect(stale.status).toBe(409)
    const original = await env.DB.prepare(
      'SELECT title FROM portal_resources WHERE event_id = ? AND id = ?',
    )
      .bind('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', resource.id)
      .first<{ title: string }>()
    expect(original?.title).toBe('Speaker guide')
  })
})
