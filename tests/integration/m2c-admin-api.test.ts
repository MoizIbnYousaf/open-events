import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

async function authedRequest(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  overrides: Record<string, unknown> = {},
) {
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
    bindings(overrides),
  )
}

describe('admin reads with organizer session', () => {
  it('returns the event config, taxonomy, forms, versions, and draft DTOs', async () => {
    const { token } = await loginOrganizer()
    expect(token).toBeTruthy()
    const tokenValue = token ?? ''

    const config = await authedRequest('GET', '/api/admin/events/demo-conf-2026', tokenValue)
    expect(config.status).toBe(200)
    expect(await config.json()).toMatchObject({
      id: DEMO_CONF_2026_ID,
      slug: 'demo-conf-2026',
      name: 'DemoConf 2026',
    })

    const taxonomy = await authedRequest(
      'GET',
      '/api/admin/events/demo-conf-2026/taxonomies',
      tokenValue,
    )
    expect(taxonomy.status).toBe(200)
    expect((await taxonomy.json()) as { items: unknown[] }).toHaveProperty('items')

    const forms = await authedRequest('GET', '/api/admin/events/demo-conf-2026/forms', tokenValue)
    expect(forms.status).toBe(200)
    expect(forms.headers.get('content-type')).toContain('application/json')

    const versions = await authedRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/versions`,
      tokenValue,
    )
    expect(versions.status).toBe(200)
    expect(await versions.json()).toHaveLength(1)

    const versionDetail = await authedRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/versions/${DEMO_CONF_2026_VERSION_ID}`,
      tokenValue,
    )
    expect(versionDetail.status).toBe(200)

    const draft = await authedRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/draft`,
      tokenValue,
    )
    expect(draft.status).toBe(404)
  })

  it('returns safe 404 for guessed or foreign ids', async () => {
    const { token } = await loginOrganizer()
    const tokenValue = token ?? ''

    expect((await authedRequest('GET', '/api/admin/events/unknown-event', tokenValue)).status).toBe(
      404,
    )
    expect(
      (
        await authedRequest(
          'GET',
          `/api/admin/events/demo-conf-2026/forms/unknown-form/versions`,
          tokenValue,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await authedRequest(
          'GET',
          '/api/admin/events/demo-conf-2026/submissions/guessed-id',
          tokenValue,
        )
      ).status,
    ).toBe(404)
  })

  it('rejects organizer routes without a session (401) and with a submitter session (403)', async () => {
    expect(
      (await app.request('/api/admin/events/demo-conf-2026', undefined, bindings())).status,
    ).toBe(401)
    const submitter = await submitterCookie(env.DB)
    expect(
      (
        await app.request(
          '/api/admin/events/demo-conf-2026',
          { headers: { cookie: `sp_session=${submitter}` } },
          bindings(),
        )
      ).status,
    ).toBe(403)
  })
})

describe('admin mutations with CSRF', () => {
  it('PATCH event config validates input and returns the DTO', async () => {
    const { token } = await loginOrganizer()
    const tokenValue = token ?? ''

    const invalid = await authedRequest('PATCH', '/api/admin/events/demo-conf-2026', tokenValue, {
      timezone: 42,
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })

    const ok = await authedRequest('PATCH', '/api/admin/events/demo-conf-2026', tokenValue, {
      venue: 'Hamburg',
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ venue: 'Hamburg' })
  })

  it('PUT taxonomies replaces and returns the list', async () => {
    const { token } = await loginOrganizer()
    const tokenValue = token ?? ''

    const ok = await authedRequest(
      'PUT',
      '/api/admin/events/demo-conf-2026/taxonomies',
      tokenValue,
      {
        items: [
          { kind: 'track', key: 'workshop', label: 'Workshop', position: 0 },
          { kind: 'track', key: 'talk', label: 'Talk', position: 1 },
        ],
      },
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ eventId: DEMO_CONF_2026_ID })

    const duplicate = await authedRequest(
      'PUT',
      '/api/admin/events/demo-conf-2026/taxonomies',
      tokenValue,
      {
        items: [
          { kind: 'track', key: 'x', label: 'X', position: 0 },
          { kind: 'track', key: 'x', label: 'Y', position: 1 },
        ],
      },
    )
    expect(duplicate.status).toBe(400)
  })

  it('PUT form draft validates and persists; publish without a draft returns 409', async () => {
    const { token } = await loginOrganizer()
    const tokenValue = token ?? ''

    const publishEmpty = await authedRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/publish`,
      tokenValue,
    )
    expect(publishEmpty.status).toBe(409)

    const save = await authedRequest(
      'PUT',
      `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/draft`,
      tokenValue,
      { pages: [], elements: [], conditionRules: [], routingRules: [] },
    )
    expect(save.status).toBe(200)

    const publish = await authedRequest(
      'POST',
      `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/publish`,
      tokenValue,
    )
    expect(publish.status).toBe(200)
    expect(await publish.json()).toMatchObject({
      formId: DEMO_CONF_2026_FORM_ID,
      status: 'published',
    })
  })

  it('rejects mutations without a CSRF-allowed origin (403) including missing/malformed/empty-allowlist', async () => {
    const { token } = await loginOrganizer()
    const tokenValue = token ?? ''
    const patch = (origin: string | undefined, referer: string | undefined, overrides = {}) =>
      app.request(
        '/api/admin/events/demo-conf-2026',
        {
          method: 'PATCH',
          headers: {
            cookie: cookieHeader(tokenValue),
            'content-type': 'application/json',
            ...(origin === undefined ? {} : { origin }),
            ...(referer === undefined ? {} : { referer }),
          },
          body: JSON.stringify({ venue: 'X' }),
        },
        bindings(overrides),
      )

    expect((await patch(undefined, undefined)).status).toBe(403)
    expect((await patch('http://evil.example', undefined)).status).toBe(403)
    expect((await patch('not-a-url', undefined)).status).toBe(403)
    expect((await patch(undefined, 'http://evil.example/')).status).toBe(403)
    expect((await patch(ALLOWED_ORIGIN, undefined, { ALLOWED_ORIGINS: '' })).status).toBe(403)
    // An explicitly empty allowlist denies everything in local dev mode too:
    // only a genuinely unset value may fall back to the dev origins.
    expect(
      (await patch(ALLOWED_ORIGIN, undefined, { ALLOWED_ORIGINS: '', LOCAL_DEV_MODE: 'true' }))
        .status,
    ).toBe(403)
  })

  it('applies Origin-over-Referer precedence and Referer fallback', async () => {
    const { token } = await loginOrganizer()
    const tokenValue = token ?? ''
    const request = (headers: Record<string, string>) =>
      app.request(
        '/api/admin/events/demo-conf-2026',
        {
          method: 'PATCH',
          headers: {
            cookie: cookieHeader(tokenValue),
            'content-type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({ venue: 'X' }),
        },
        bindings(),
      )

    expect(
      (await request({ origin: ALLOWED_ORIGIN, referer: 'http://evil.example/' })).status,
    ).toBe(200)
    expect(
      (await request({ origin: 'http://evil.example', referer: ALLOWED_ORIGIN + '/' })).status,
    ).toBe(403)
    expect((await request({ referer: ALLOWED_ORIGIN + '/x' })).status).toBe(200)
  })

  it('uses the local/test fallback origins when ALLOWED_ORIGINS is unset', async () => {
    const { token } = await loginOrganizer({ ALLOWED_ORIGINS: undefined })
    const tokenValue = token ?? ''
    const response = await app.request(
      '/api/admin/events/demo-conf-2026',
      {
        method: 'PATCH',
        headers: {
          cookie: cookieHeader(tokenValue),
          origin: 'http://localhost:8787',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ venue: 'X' }),
      },
      bindings({ ALLOWED_ORIGINS: undefined, LOCAL_DEV_MODE: 'true' }),
    )

    expect(response.status).toBe(200)
  })
})

describe('organizer submissions views', () => {
  it('lists submissions and returns detail DTOs', async () => {
    const { token } = await loginOrganizer()
    const tokenValue = token ?? ''
    const submitter = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(submitter)

    const submit = await app.request(
      '/api/public/submit',
      {
        method: 'POST',
        headers: {
          cookie: `sp_session=${submitter}`,
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          originDraftId: draftId,
          formVersionId: DEMO_CONF_2026_VERSION_ID,
          title: 'Route submission',
          answers: { format: 'workshop', workshop_details: 'Hands-on' },
          coSpeakers: [],
        }),
      },
      bindings(),
    )
    expect(submit.status).toBe(200)
    const detail = (await submit.json()) as { id: string }

    const list = await authedRequest(
      'GET',
      '/api/admin/events/demo-conf-2026/submissions',
      tokenValue,
    )
    expect(list.status).toBe(200)
    expect(await list.json()).toHaveLength(1)

    const one = await authedRequest(
      'GET',
      `/api/admin/events/demo-conf-2026/submissions/${detail.id}`,
      tokenValue,
    )
    expect(one.status).toBe(200)
    expect(await one.json()).toMatchObject({ id: detail.id, status: 'pending' })
  })
})
