import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { applyMigrations, countRows, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function submit(
  cookie: string,
  body: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return app.request(
    '/api/public/submit',
    {
      method: 'POST',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    bindings(overrides),
  )
}

describe('public CFP definition', () => {
  it('returns the published definition with eventSlug and no routingRules', async () => {
    const response = await app.request('/api/public/cfp/demo-conf-2026/cfp', undefined, bindings())

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.eventSlug).toBe('demo-conf-2026')
    expect(body.formSlug).toBe('cfp')
    expect(body).not.toHaveProperty('routingRules')
    expect(body.conditionRules).toBeInstanceOf(Array)
    expect(
      (await app.request('/api/public/cfp/unknown-event/cfp', undefined, bindings())).status,
    ).toBe(404)
  })
})

describe('submitter drafts are own-only', () => {
  it('saves, reads, and lists drafts for the session actor', async () => {
    const cookie = await submitterCookie(env.DB)
    const save = await app.request(
      '/api/public/draft',
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: null,
          formId: DEMO_CONF_2026_FORM_ID,
          formVersionId: DEMO_CONF_2026_VERSION_ID,
          title: 'My draft',
          answers: { format: 'talk' },
        }),
      },
      bindings(),
    )
    expect(save.status).toBe(200)
    const draft = (await save.json()) as { id: string }

    const active = await app.request(
      `/api/public/draft?formId=${DEMO_CONF_2026_FORM_ID}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(active.status).toBe(200)
    expect(await active.json()).toMatchObject({ id: draft.id })

    const one = await app.request(
      `/api/public/draft/${draft.id}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(one.status).toBe(200)
  })

  it('a second identity cannot read the first identity draft (404)', async () => {
    const first = await submitterCookie(env.DB)
    const save = await app.request(
      '/api/public/draft',
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(first),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: null,
          formId: DEMO_CONF_2026_FORM_ID,
          formVersionId: DEMO_CONF_2026_VERSION_ID,
          title: 'Mine',
          answers: {},
        }),
      },
      bindings(),
    )
    expect(save.status).toBe(200)
    const draft = (await save.json()) as { id: string }

    const second = await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'other@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
        }),
      },
      bindings(),
    )
    expect(second.status).toBe(202)
    const message = await env.DB.prepare(
      'SELECT body FROM captured_messages WHERE to_email = ? ORDER BY created_at DESC LIMIT 1',
    )
      .bind('other@example.test')
      .first<{ body: string }>()
    const raw = decodeURIComponent(message?.body.split('token=')[1] ?? '')
    const redeem = await app.request(
      `/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )
    const secondCookie = (redeem.headers.get('set-cookie') ?? '').match(/sp_session=([^;]+)/)?.[1]
    expect(secondCookie).toBeTruthy()

    const denied = await app.request(
      `/api/public/draft/${draft.id}`,
      { headers: { cookie: cookieHeader(secondCookie ?? '') } },
      bindings(),
    )
    expect(denied.status).toBe(404)
  })
})

describe('submitter submit', () => {
  const submitBody = {
    originDraftId: 'draft-route-1',
    formVersionId: DEMO_CONF_2026_VERSION_ID,
    title: 'Route submission',
    answers: { format: 'workshop', workshop_details: 'Hands-on' },
    coSpeakers: [],
  }

  it('submits once and an idempotent retry returns the existing submission', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)
    const first = await submit(cookie, { ...submitBody, originDraftId: draftId })
    expect(first.status).toBe(200)
    const detail = (await first.json()) as { id: string; status: string }
    expect(detail.status).toBe('pending')

    const retry = await submit(cookie, { ...submitBody, originDraftId: draftId })
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ id: detail.id })
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'submission_contributors')).toBe(1)
  })

  it('maps the seeded per-identity limit to 409 identity_limit_reached', async () => {
    const cookie = await submitterCookie(env.DB)
    const firstDraft = await savePublicDraft(cookie)
    expect((await submit(cookie, { ...submitBody, originDraftId: firstDraft })).status).toBe(200)

    const secondDraft = await savePublicDraft(cookie, { title: 'Second' })
    const denied = await submit(cookie, {
      ...submitBody,
      originDraftId: secondDraft,
      title: 'Second',
    })

    expect(denied.status).toBe(409)
    expect(await denied.json()).toEqual({
      error: {
        code: 'identity_limit_reached',
        message: 'The per-identity submission limit has been reached',
      },
    })
  })

  it('maps a closed CFP to 409 cfp_closed with zero writes', async () => {
    await env.DB.prepare('UPDATE cfp_forms SET closes_at = ? WHERE event_id = ? AND id = ?')
      .bind(
        '2026-01-02T00:00:00.000Z',
        'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d',
        DEMO_CONF_2026_FORM_ID,
      )
      .run()
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)

    const denied = await submit(cookie, { ...submitBody, originDraftId: draftId })

    expect(denied.status).toBe(409)
    expect(await denied.json()).toEqual({
      error: { code: 'cfp_closed', message: 'The call for papers is closed' },
    })
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
  })

  it('maps a capped CFP to 409 cfp_capped', async () => {
    await env.DB.prepare(
      'UPDATE cfp_forms SET total_cap = 1, per_identity_limit = NULL WHERE event_id = ? AND id = ?',
    )
      .bind('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', DEMO_CONF_2026_FORM_ID)
      .run()
    const cookie = await submitterCookie(env.DB)
    const firstDraft = await savePublicDraft(cookie)
    expect((await submit(cookie, { ...submitBody, originDraftId: firstDraft })).status).toBe(200)

    const secondDraft = await savePublicDraft(cookie, { title: 'Third' })
    const denied = await submit(cookie, {
      ...submitBody,
      originDraftId: secondDraft,
      title: 'Third',
    })

    expect(denied.status).toBe(409)
    expect(await denied.json()).toEqual({
      error: { code: 'cfp_capped', message: 'The submission cap has been reached' },
    })
  })

  it('rejects a malformed body with 400 validation_failed', async () => {
    const cookie = await submitterCookie(env.DB)
    const denied = await submit(cookie, { originDraftId: 'x' })
    expect(denied.status).toBe(400)
  })
})

describe('own submission reads', () => {
  it('returns own submission and 404 for another actor', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)
    const submitted = await submit(cookie, {
      originDraftId: draftId,
      formVersionId: DEMO_CONF_2026_VERSION_ID,
      title: 'Route submission',
      answers: { format: 'workshop', workshop_details: 'Hands-on' },
      coSpeakers: [],
    })
    expect(submitted.status).toBe(200)
    const detail = (await submitted.json()) as { id: string }

    const own = await app.request(
      `/api/public/submission/${detail.id}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(own.status).toBe(200)

    const other = await app.request(
      '/api/public/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'other@example.test',
          eventSlug: 'demo-conf-2026',
          formSlug: 'cfp',
        }),
      },
      bindings(),
    )
    expect(other.status).toBe(202)
    const message = await env.DB.prepare(
      'SELECT body FROM captured_messages WHERE to_email = ? ORDER BY created_at DESC LIMIT 1',
    )
      .bind('other@example.test')
      .first<{ body: string }>()
    const raw = decodeURIComponent(message?.body.split('token=')[1] ?? '')
    const redeem = await app.request(
      `/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )
    const otherCookie = (redeem.headers.get('set-cookie') ?? '').match(/sp_session=([^;]+)/)?.[1]
    expect(otherCookie).toBeTruthy()

    const denied = await app.request(
      `/api/public/submission/${detail.id}`,
      { headers: { cookie: cookieHeader(otherCookie ?? '') } },
      bindings(),
    )
    expect(denied.status).toBe(404)
  })
})
