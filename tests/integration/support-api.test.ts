import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import app from '../../src/server'
import { applyMigrations, capturedMessagesForEmail, seedDemoConf } from './m2b-helpers'
import { bindings, loginOrganizer } from './m2c-helpers'
import { SUPPORT_GUEST_COOKIE } from '../../src/domain/support'

const ORIGIN = 'http://localhost:8787'
const SLUG = 'demo-conf-2026'

function parseGuestCookie(setCookie: string | null): string | null {
  if (setCookie === null) return null
  const match = new RegExp(`(?:^|;\\s*)${SUPPORT_GUEST_COOKIE}=([^;]+)`).exec(setCookie)
  return match?.[1] ?? null
}

async function identifyGuest() {
  const response = await app.request(
    '/api/support-chat',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({
        eventSlug: SLUG,
        name: 'Ada Speaker',
        email: 'ada-orby@example.test',
      }),
    },
    bindings(),
  )
  const setCookie = response.headers.get('set-cookie')
  return {
    status: response.status,
    body: (await response.json()) as {
      role: string
      needsIdentity: boolean
      chat: { id: string; messages: readonly unknown[] } | null
    },
    cookie: parseGuestCookie(setCookie),
  }
}

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

describe('Orby support API', () => {
  it('keeps organizer page-aware questions behind organizer access', async () => {
    const anonymous = await app.request(
      `/api/admin/events/${SLUG}/orby/ask`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ content: 'What is this page?', pagePath: `/admin/events/${SLUG}` }),
      },
      bindings(),
    )
    expect(anonymous.status).toBe(401)

    const { token } = await loginOrganizer()
    const organizer = await app.request(
      `/api/admin/events/${SLUG}/orby/ask`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `sp_session=${token}`,
        },
        body: JSON.stringify({ content: 'What is this page?', pagePath: `/admin/events/${SLUG}` }),
      },
      bindings(),
    )
    expect(organizer.status).toBe(503)
  })

  it('asks an unknown visitor for a name and email', async () => {
    const response = await app.request(`/api/support-chat?eventSlug=${SLUG}`, undefined, bindings())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      role: 'none',
      needsIdentity: true,
      chat: null,
    })
  })

  it('opens one chat per contact, takes a user message, and shows it to the organizer', async () => {
    const guest = await identifyGuest()
    expect(guest.status).toBe(200)
    expect(guest.cookie).toBeTruthy()
    expect(guest.body.needsIdentity).toBe(false)
    expect(guest.body.chat?.messages).toEqual([])

    const sent = await app.request(
      '/api/support-chat/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `${SUPPORT_GUEST_COOKIE}=${guest.cookie}`,
        },
        body: JSON.stringify({ eventSlug: SLUG, content: 'When does the CFP close?' }),
      },
      bindings(),
    )
    expect(sent.status).toBe(200)
    expect(await sent.json()).toMatchObject({
      content: 'When does the CFP close?',
      senderType: 'user',
    })

    const { token } = await loginOrganizer()
    const list = await app.request(
      `/api/admin/events/${SLUG}/support/chats?archived=false`,
      { headers: { cookie: `sp_session=${token}` } },
      bindings(),
    )
    expect(list.status).toBe(200)
    const chats = (await list.json()) as readonly {
      id: string
      userEmail: string
      unread: boolean
      lastMessagePreview: string
    }[]
    expect(chats[0]).toMatchObject({
      userEmail: 'ada-orby@example.test',
      unread: true,
      lastMessagePreview: 'When does the CFP close?',
    })

    const reply = await app.request(
      `/api/admin/events/${SLUG}/support/chats/${chats[0]!.id}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `sp_session=${token}`,
        },
        body: JSON.stringify({ content: 'It closes on the published window.' }),
      },
      bindings(),
    )
    expect(reply.status).toBe(200)
    expect(await reply.json()).toMatchObject({
      senderType: 'admin',
      senderName: 'Orby',
    })

    const again = await app.request(
      `/api/support-chat?eventSlug=${SLUG}`,
      { headers: { cookie: `${SUPPORT_GUEST_COOKIE}=${guest.cookie}` } },
      bindings(),
    )
    const session = (await again.json()) as {
      chat: { unreadCount: number; messages: readonly { senderType: string }[] }
    }
    expect(session.chat.unreadCount).toBe(1)
    expect(session.chat.messages.map((message) => message.senderType)).toEqual(['user', 'admin'])
  })

  it('archives, then unarchives when the visitor writes again', async () => {
    const guest = await identifyGuest()
    await app.request(
      '/api/support-chat/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `${SUPPORT_GUEST_COOKIE}=${guest.cookie}`,
        },
        body: JSON.stringify({ eventSlug: SLUG, content: 'Need a receipt.' }),
      },
      bindings(),
    )
    const { token } = await loginOrganizer()
    const list = (await (
      await app.request(
        `/api/admin/events/${SLUG}/support/chats?archived=false`,
        { headers: { cookie: `sp_session=${token}` } },
        bindings(),
      )
    ).json()) as readonly { id: string }[]
    const chatId = list[0]!.id

    const archived = await app.request(
      `/api/admin/events/${SLUG}/support/chats/${chatId}/archive`,
      {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: `sp_session=${token}` },
      },
      bindings(),
    )
    expect(archived.status).toBe(200)
    expect(await archived.json()).toMatchObject({ archived: true })

    await app.request(
      '/api/support-chat/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `${SUPPORT_GUEST_COOKIE}=${guest.cookie}`,
        },
        body: JSON.stringify({ eventSlug: SLUG, content: 'Still here.' }),
      },
      bindings(),
    )

    const active = (await (
      await app.request(
        `/api/admin/events/${SLUG}/support/chats?archived=false`,
        { headers: { cookie: `sp_session=${token}` } },
        bindings(),
      )
    ).json()) as readonly { id: string }[]
    expect(active.some((row) => row.id === chatId)).toBe(true)
  })

  it('sends the delayed Orby email only while the reply is still unread', async () => {
    const guest = await identifyGuest()
    await app.request(
      '/api/support-chat/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `${SUPPORT_GUEST_COOKIE}=${guest.cookie}`,
        },
        body: JSON.stringify({ eventSlug: SLUG, content: 'Hello' }),
      },
      bindings(),
    )
    const { token } = await loginOrganizer()
    const list = (await (
      await app.request(
        `/api/admin/events/${SLUG}/support/chats?archived=false`,
        { headers: { cookie: `sp_session=${token}` } },
        bindings(),
      )
    ).json()) as readonly { id: string }[]
    await app.request(
      `/api/admin/events/${SLUG}/support/chats/${list[0]!.id}/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: `sp_session=${token}`,
        },
        body: JSON.stringify({ content: 'Here is the link.' }),
      },
      bindings(),
    )

    await env.DB.prepare(
      `UPDATE support_messages SET notify_after = '2020-01-01T00:00:00.000Z'
        WHERE sender_type = 'admin'`,
    ).run()

    await app.request(`/api/support-chat?eventSlug=${SLUG}`, undefined, bindings())

    const mailed = (await capturedMessagesForEmail(env.DB, 'ada-orby@example.test')).find(
      (message) => message.kind === 'reminder',
    )
    expect(mailed?.subject).toBe('New reply from Orby')
  })
})
