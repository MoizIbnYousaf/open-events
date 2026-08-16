import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { createSha256TokenHasher } from '../../src/application'
import {
  SEEDED_TALK_ANSWERS,
  SEEDED_WORKSHOP_ANSWERS,
  applyMigrations,
  countRows,
  latestCapturedBody,
  seedDemoConf,
} from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  parseCookieToken,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

const hasher = createSha256TokenHasher()

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

async function setSessionCapability(
  rawSession: string,
  capability: 'cfp' | 'portal' | 'evaluation' | null,
): Promise<void> {
  const tokenHash = await hasher.hash(rawSession)
  await env.DB.prepare(`UPDATE sessions SET capability = ?, created_at = ? WHERE token_hash = ?`)
    .bind(capability, '2026-08-14T12:00:00.000Z', tokenHash)
    .run()
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
          answers: SEEDED_TALK_ANSWERS,
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
    const body = await latestCapturedBody(env.DB, 'other@example.test')
    const raw = decodeURIComponent(body?.split('token=')[1] ?? '')
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

describe('submitter route capabilities', () => {
  it.each([
    ['portal', `/api/public/draft?formId=${DEMO_CONF_2026_FORM_ID}`],
    ['evaluation', `/api/public/draft?formId=${DEMO_CONF_2026_FORM_ID}`],
    ['cfp', '/api/public/profile'],
    ['evaluation', '/api/public/profile'],
    ['cfp', '/api/public/evaluations'],
    ['portal', '/api/public/evaluations'],
  ] as const)('denies a %s session at the wrong route boundary', async (capability, path) => {
    const cookie = await submitterCookie(env.DB)
    await setSessionCapability(cookie, capability)

    const response = await app.request(
      path,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )

    expect(response.status).toBe(403)
  })

  it('preserves bounded legacy-null broad authority without guessing a replacement capability', async () => {
    const cookie = await submitterCookie(env.DB)
    await setSessionCapability(cookie, null)
    const legacyContact = await env.DB.prepare('SELECT id FROM contacts WHERE email = ?')
      .bind('speaker-a@example.test')
      .first<{ id: string }>()
    await env.DB.prepare(
      'INSERT INTO evaluation_committee_members (event_id, contact_id, added_at) VALUES (?, ?, ?)',
    )
      .bind('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', legacyContact?.id, '2026-08-14T12:00:00.000Z')
      .run()
    const legacyBindings = bindings({
      SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: '2026-08-14T23:59:59.000Z',
    })

    for (const path of [
      `/api/public/draft?formId=${DEMO_CONF_2026_FORM_ID}`,
      '/api/public/profile',
      '/api/public/evaluations',
    ]) {
      const response = await app.request(
        path,
        { headers: { cookie: cookieHeader(cookie) } },
        legacyBindings,
      )
      expect(response.status).not.toBe(403)
      expect(response.status).not.toBe(401)
    }
  })
})

describe('submitter submit', () => {
  const submitBody = {
    originDraftId: 'draft-route-1',
    formVersionId: DEMO_CONF_2026_VERSION_ID,
    title: 'Route submission',
    answers: SEEDED_WORKSHOP_ANSWERS,
    coSpeakers: [],
  }

  it('submits once, rotates CFP access to portal, and rejects the consumed CFP cookie', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)
    const first = await submit(cookie, { ...submitBody, originDraftId: draftId })
    expect(first.status).toBe(200)
    const detail = (await first.json()) as { id: string; status: string }
    expect(detail.status).toBe('pending')
    const portalCookie = parseCookieToken(first.headers.get('set-cookie'))
    expect(portalCookie).not.toBeNull()

    const consumedCfp = await app.request(
      `/api/public/draft?formId=${DEMO_CONF_2026_FORM_ID}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(consumedCfp.status).toBe(401)
    const portal = await app.request(
      '/api/public/submissions',
      { headers: { cookie: cookieHeader(portalCookie ?? '') } },
      bindings(),
    )
    expect(portal.status).toBe(200)
    const wrongCfpAction = await app.request(
      '/api/public/draft',
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(portalCookie ?? ''),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      },
      bindings(),
    )
    expect(wrongCfpAction.status).toBe(403)
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'submission_contributors')).toBe(1)
  })

  it('reissues the same portal handoff when the successful submit response is lost', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)
    const body = { ...submitBody, originDraftId: draftId }

    const first = await submit(cookie, body)
    expect(first.status).toBe(200)
    const firstDetail = (await first.json()) as { id: string }
    const firstPortalCookie = parseCookieToken(first.headers.get('set-cookie'))
    expect(firstPortalCookie).not.toBeNull()

    // Model a response lost after the atomic business commit: the browser only
    // has the consumed CFP secret and repeats the exact request.
    const retry = await submit(cookie, body)
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ id: firstDetail.id })
    expect(parseCookieToken(retry.headers.get('set-cookie'))).toBe(firstPortalCookie)
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(1)

    // The consumed secret is not a general CFP session and a changed request
    // is not the exact idempotent handoff retry.
    expect(
      (
        await submit(cookie, {
          ...body,
          title: 'A different request must not recover portal authority',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(
          `/api/public/draft?formId=${DEMO_CONF_2026_FORM_ID}`,
          { headers: { cookie: cookieHeader(cookie) } },
          bindings(),
        )
      ).status,
    ).toBe(401)
  })

  it('rolls back the business commit if portal handoff preparation fails', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)

    const failed = await submit(
      cookie,
      { ...submitBody, originDraftId: draftId },
      { SUBMITTER_SESSION_TTL_MS: 'not-a-duration' },
    )

    expect(failed.status).toBe(500)
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(0)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(1)
  })

  it('converges concurrent duplicate submits on one submission and one portal authority', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)
    const body = { ...submitBody, originDraftId: draftId }

    const [left, right] = await Promise.all([submit(cookie, body), submit(cookie, body)])

    expect([left.status, right.status]).toEqual([200, 200])
    const leftBody = (await left.json()) as { id: string }
    const rightBody = (await right.json()) as { id: string }
    expect(rightBody.id).toBe(leftBody.id)
    expect(parseCookieToken(right.headers.get('set-cookie'))).toBe(
      parseCookieToken(left.headers.get('set-cookie')),
    )
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(1)
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE kind = 'submitter' AND capability = 'portal' AND consumed_at IS NULL",
      ).first(),
    ).toEqual({ count: 1 })
  })

  it('lets one of two different drafts consume a CFP cookie and rejects the loser without writes', async () => {
    const cookie = await submitterCookie(env.DB)
    const firstDraftId = await savePublicDraft(cookie)
    const owner = await env.DB.prepare('SELECT contact_id FROM sessions WHERE token_hash = ?')
      .bind(await hasher.hash(cookie))
      .first<{ contact_id: string }>()
    const secondDraftId = 'draft-route-concurrent-other'
    const now = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO proposal_drafts
         (id, event_id, owner_contact_id, form_version_id, title, answers_json, created_at, updated_at)
       VALUES (?, 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        secondDraftId,
        owner?.contact_id,
        DEMO_CONF_2026_VERSION_ID,
        'Other concurrent draft',
        JSON.stringify(SEEDED_WORKSHOP_ANSWERS),
        now,
        now,
      )
      .run()

    const [left, right] = await Promise.all([
      submit(cookie, { ...submitBody, originDraftId: firstDraftId, title: 'First concurrent' }),
      submit(cookie, { ...submitBody, originDraftId: secondDraftId, title: 'Other concurrent' }),
    ])

    expect([left.status, right.status].toSorted()).toEqual([200, 403])
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(1)
    expect(await countRows(env.DB, 'submit_session_handoffs')).toBe(1)
    expect(await countRows(env.DB, 'proposal_drafts')).toBe(1)
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE capability = 'portal' AND consumed_at IS NULL",
      ).first(),
    ).toEqual({ count: 1 })
  })

  it('atomically hands an in-window legacy-null CFP session into one portal authority', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)
    await setSessionCapability(cookie, null)
    const configured = {
      SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'bounded',
      SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: '2026-08-14T23:59:59.000Z',
    }
    const body = { ...submitBody, originDraftId: draftId }

    const [left, right] = await Promise.all([
      submit(cookie, body, configured),
      submit(cookie, body, configured),
    ])

    expect([left.status, right.status]).toEqual([200, 200])
    expect(await left.json()).toMatchObject({ id: expect.any(String), status: 'pending' })
    const leftPortal = parseCookieToken(left.headers.get('set-cookie'))
    const rightPortal = parseCookieToken(right.headers.get('set-cookie'))
    expect(leftPortal).not.toBeNull()
    expect(rightPortal).toBe(leftPortal)
    expect(
      (
        await app.request(
          `/api/public/draft?formId=${DEMO_CONF_2026_FORM_ID}`,
          { headers: { cookie: cookieHeader(cookie) } },
          bindings(configured),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await app.request(
          '/api/public/submissions',
          { headers: { cookie: cookieHeader(leftPortal ?? '') } },
          bindings(configured),
        )
      ).status,
    ).toBe(200)
    expect(
      (await submit(cookie, { ...body, title: 'Changed legacy retry must fail' }, configured))
        .status,
    ).toBe(403)
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(1)
    expect(await countRows(env.DB, 'confirmation_records')).toBe(1)
  })

  it('denies legacy-null final submit after the bounded session horizon', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie)
    const cutoff = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    await env.DB.prepare(
      'UPDATE sessions SET capability = NULL, created_at = ? WHERE token_hash = ?',
    )
      .bind(new Date(Date.parse(cutoff) - 1).toISOString(), await hasher.hash(cookie))
      .run()

    const denied = await submit(
      cookie,
      { ...submitBody, originDraftId: draftId },
      {
        SUBMITTER_CAPABILITY_LEGACY_READER_MODE: 'bounded',
        SUBMITTER_CAPABILITY_LEGACY_WRITER_CUTOFF: cutoff,
      },
    )

    expect(denied.status).toBe(403)
    expect(await countRows(env.DB, 'proposal_submissions')).toBe(0)
  })

  it('maps the per-identity limit to 409 identity_limit_reached', async () => {
    await env.DB.prepare(
      'UPDATE cfp_forms SET per_identity_limit = 1 WHERE event_id = ? AND id = ?',
    )
      .bind('a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d', DEMO_CONF_2026_FORM_ID)
      .run()
    const cookie = await submitterCookie(env.DB)
    const firstDraft = await savePublicDraft(cookie)
    expect((await submit(cookie, { ...submitBody, originDraftId: firstDraft })).status).toBe(200)

    const secondCfpCookie = await submitterCookie(env.DB)
    const secondDraft = await savePublicDraft(secondCfpCookie, { title: 'Second' })
    const denied = await submit(secondCfpCookie, {
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

    const secondCfpCookie = await submitterCookie(env.DB)
    const secondDraft = await savePublicDraft(secondCfpCookie, { title: 'Third' })
    const denied = await submit(secondCfpCookie, {
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
      answers: SEEDED_WORKSHOP_ANSWERS,
      coSpeakers: [],
    })
    expect(submitted.status).toBe(200)
    const detail = (await submitted.json()) as { id: string }
    const portalCookie = parseCookieToken(submitted.headers.get('set-cookie'))
    expect(portalCookie).not.toBeNull()

    const own = await app.request(
      `/api/public/submission/${detail.id}`,
      { headers: { cookie: cookieHeader(portalCookie ?? '') } },
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
    const body = await latestCapturedBody(env.DB, 'other@example.test')
    const raw = decodeURIComponent(body?.split('token=')[1] ?? '')
    const redeem = await app.request(
      `/api/public/session?token=${encodeURIComponent(raw)}`,
      undefined,
      bindings(),
    )
    const otherCookie = (redeem.headers.get('set-cookie') ?? '').match(/sp_session=([^;]+)/)?.[1]
    expect(otherCookie).toBeTruthy()
    await setSessionCapability(otherCookie ?? '', 'portal')

    const denied = await app.request(
      `/api/public/submission/${detail.id}`,
      { headers: { cookie: cookieHeader(otherCookie ?? '') } },
      bindings(),
    )
    expect(denied.status).toBe(404)
  })
})
