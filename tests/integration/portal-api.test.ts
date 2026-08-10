import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  parseCookieToken,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

// Speaker portal API contract: GET /api/public/submissions returns only the
// signed-in speaker's own submissions for their own event, newest submission
// first, as a { submissions } envelope of list items. Anonymous requests get
// the standard nested error envelope with 401. No cross-owner rows may ever
// appear, and heavy detail payloads (answers) stay out of the list.

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function speakerCookie(email: string): Promise<string> {
  const start = await app.request(
    '/api/public/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, eventSlug: 'demo-conf-2026', formSlug: 'cfp' }),
    },
    bindings(),
  )
  if (start.status !== 202) throw new Error(`start failed with ${start.status}`)
  const message = await env.DB.prepare(
    'SELECT body FROM captured_messages WHERE to_email = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(email)
    .first<{ body: string }>()
  if (message === null) throw new Error('no captured message found')
  const raw = decodeURIComponent(message.body.split('token=')[1] ?? '')
  const redeem = await app.request(
    `/api/public/session?token=${encodeURIComponent(raw)}`,
    undefined,
    bindings(),
  )
  if (redeem.status !== 303) throw new Error(`redeem failed with ${redeem.status}`)
  const token = parseCookieToken(redeem.headers.get('set-cookie'))
  if (token === null) throw new Error('redeem set no session cookie')
  return token
}

async function submitAs(cookie: string, title: string): Promise<string> {
  const draftId = await savePublicDraft(cookie, { title })
  const response = await app.request(
    '/api/public/submit',
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        originDraftId: draftId,
        formVersionId: DEMO_CONF_2026_VERSION_ID,
        title,
        answers: { format: 'talk' },
        coSpeakers: [],
      }),
    },
    bindings(),
  )
  expect(response.status).toBe(200)
  const detail = (await response.json()) as { id: string }
  return detail.id
}

async function listOwn(cookie?: string) {
  return app.request(
    '/api/public/submissions',
    cookie === undefined ? undefined : { headers: { cookie: cookieHeader(cookie) } },
    bindings(),
  )
}

describe('speaker portal API', () => {
  it('rejects anonymous access with the standard 401 envelope', async () => {
    const response = await listOwn()
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBeTypeOf('string')
    expect(body.error.message).toBeTypeOf('string')
    expect(Object.keys(body)).toEqual(['error'])
  })

  it('returns only the owner submissions, newest first, as list items', async () => {
    const ada = await submitterCookie(env.DB)
    const first = await submitAs(ada, 'First accepted talk idea')
    const second = await submitAs(ada, 'Second better talk idea')

    const response = await listOwn(ada)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      submissions: ReadonlyArray<Record<string, unknown>>
    }
    expect(body.submissions).toHaveLength(2)
    expect(body.submissions.map((s) => s.id)).toEqual([second, first])
    for (const item of body.submissions) {
      expect(item.title).toBeTypeOf('string')
      expect(item.status).toBeTypeOf('string')
      expect(item).not.toHaveProperty('answers')
    }
  })

  it('never leaks another speaker submissions', async () => {
    const ada = await submitterCookie(env.DB)
    await submitAs(ada, 'Ada only talk')

    const grace = await speakerCookie('speaker.grace@example.test')
    const response = await listOwn(grace)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { submissions: ReadonlyArray<unknown> }
    expect(body.submissions).toHaveLength(0)
  })
})
