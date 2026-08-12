import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import { SEEDED_TALK_ANSWERS, applyMigrations, seedDemoConf } from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

/**
 * The two ends of a call's lifetime that the product had no words for.
 *
 * The submission window was enforced from the first release and configurable
 * nowhere: the public portal announced a close date no organizer could move. And
 * a proposal, once sent, became unreachable to the person who wrote it — the
 * portal listed a title and a status and offered no way back in, so a typo in an
 * abstract was permanent.
 *
 * Both halves are one lifecycle: the window decides whether the door is open, and
 * the edit is what walking back through it does. Closing the call therefore has to
 * lock the edit as well as the door.
 */
beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

const PAST = '2020-01-01T00:00:00.000Z'
const FUTURE = '2030-12-31T23:59:59.000Z'
const WINDOW_PATH = `/api/admin/events/demo-conf-2026/forms/${DEMO_CONF_2026_FORM_ID}/window`

async function setWindow(
  cookie: string,
  body: Record<string, unknown>,
  origin = ALLOWED_ORIGIN,
): Promise<Response> {
  return app.request(
    WINDOW_PATH,
    {
      method: 'PUT',
      headers: { cookie: cookieHeader(cookie), origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    bindings(),
  )
}

/** loginOrganizer returns a response envelope; the session value is `token`. */
async function organizerCookie(): Promise<string> {
  const session = await loginOrganizer()
  expect(session.token).not.toBeNull()
  return session.token ?? ''
}

async function publicDefinition(): Promise<Record<string, unknown>> {
  const response = await app.request('/api/public/cfp/demo-conf-2026/cfp', undefined, bindings())
  return (await response.json()) as Record<string, unknown>
}

/** A speaker with one submitted proposal; returns their cookie and its id. */
async function speakerWithSubmission(): Promise<{ cookie: string; submissionId: string }> {
  const cookie = await submitterCookie(env.DB)
  const draftId = await savePublicDraft(cookie, {
    title: 'Taming 40-Minute CI',
    answers: SEEDED_TALK_ANSWERS,
  })
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
        title: 'Taming 40-Minute CI',
        answers: SEEDED_TALK_ANSWERS,
        coSpeakers: [],
      }),
    },
    bindings(),
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as { id: string }
  return { cookie, submissionId: body.id }
}

async function editSubmission(
  cookie: string,
  submissionId: string,
  body: Record<string, unknown>,
  origin = ALLOWED_ORIGIN,
): Promise<Response> {
  return app.request(
    `/api/public/submission/${submissionId}`,
    {
      method: 'PUT',
      headers: { cookie: cookieHeader(cookie), origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    bindings(),
  )
}

describe('an organizer owns the submission window', () => {
  it('persists a new close date and publishes it to the public definition', async () => {
    const organizer = await organizerCookie()
    const response = await setWindow(organizer, { opensAt: null, closesAt: FUTURE })
    expect(response.status).toBe(200)
    expect(await publicDefinition()).toMatchObject({ closesAt: FUTURE, opensAt: null })
  })

  it('refuses a close date that is not after the open date', async () => {
    const organizer = await organizerCookie()
    const response = await setWindow(organizer, { opensAt: FUTURE, closesAt: PAST })
    expect(response.status).toBe(400)
    // The stored window is untouched by a refused write.
    expect(await publicDefinition()).toMatchObject({ closesAt: '2026-12-31T23:59:59.000Z' })
  })

  it('is organizer-only and same-origin only', async () => {
    const speaker = await submitterCookie(env.DB)
    expect((await setWindow(speaker, { opensAt: null, closesAt: FUTURE })).status).toBe(403)
    const anonymous = await app.request(
      WINDOW_PATH,
      {
        method: 'PUT',
        headers: { origin: ALLOWED_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ opensAt: null, closesAt: FUTURE }),
      },
      bindings(),
    )
    expect(anonymous.status).toBe(401)
    const organizer = await organizerCookie()
    expect(
      (await setWindow(organizer, { opensAt: null, closesAt: FUTURE }, 'https://evil.test')).status,
    ).toBe(403)
  })
})

describe('a closed call turns the public portal away', () => {
  it('reports the call closed once the close date is in the past', async () => {
    const organizer = await organizerCookie()
    expect((await setWindow(organizer, { opensAt: null, closesAt: PAST })).status).toBe(200)
    const definition = await publicDefinition()
    // The definition still describes the form — a closed call is still readable —
    // but it says plainly that it is closed, so the portal has something honest
    // to render without having to compute a verdict from a date itself.
    expect(definition.closesAt).toBe(PAST)
    expect(definition.submissionState).toBe('closed')
  })

  it('reports the call not yet open before the open date', async () => {
    const organizer = await organizerCookie()
    expect((await setWindow(organizer, { opensAt: FUTURE, closesAt: null })).status).toBe(200)
    expect((await publicDefinition()).submissionState).toBe('not-yet-open')
  })

  it('reports the call open inside the window', async () => {
    expect((await publicDefinition()).submissionState).toBe('open')
  })

  it('refuses a submission after the close date', async () => {
    const cookie = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(cookie, {
      title: 'Too late',
      answers: SEEDED_TALK_ANSWERS,
    })
    const organizer = await organizerCookie()
    await setWindow(organizer, { opensAt: null, closesAt: PAST })
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
          title: 'Too late',
          answers: SEEDED_TALK_ANSWERS,
          coSpeakers: [],
        }),
      },
      bindings(),
    )
    expect(response.status).toBe(409)
  })
})

describe('a submitter can edit their own proposal while the call is open', () => {
  const APPENDED = 'Updated: now includes 2026 benchmark data.'

  it('reads back the full submitted answers, not just a title', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const response = await app.request(
      `/api/public/submission/${submissionId}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(response.status).toBe(200)
    const detail = (await response.json()) as Record<string, unknown>
    expect(detail.answers).toEqual(SEEDED_TALK_ANSWERS)
    expect(detail.title).toBe('Taming 40-Minute CI')
    // Whether the speaker may still edit is the server's judgement, not a date
    // the client re-derives.
    expect(detail.editable).toBe(true)
  })

  it('persists an edited abstract and shows it to the organizer verbatim', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const edited = `${SEEDED_TALK_ANSWERS.abstract} ${APPENDED}`
    const response = await editSubmission(cookie, submissionId, {
      title: 'Taming 40-Minute CI',
      answers: { ...SEEDED_TALK_ANSWERS, abstract: edited },
    })
    expect(response.status).toBe(200)

    // Speaker side, read fresh.
    const reread = await app.request(
      `/api/public/submission/${submissionId}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(((await reread.json()) as { answers: Record<string, string> }).answers.abstract).toBe(
      edited,
    )

    // Organizer side, the same sentence.
    const organizer = await organizerCookie()
    const detail = await app.request(
      `/api/admin/events/demo-conf-2026/submissions/${submissionId}`,
      { headers: { cookie: cookieHeader(organizer) } },
      bindings(),
    )
    const organizerView = (await detail.json()) as { answers: Record<string, string> }
    expect(organizerView.answers.abstract).toBe(edited)
    expect(organizerView.answers.abstract).toContain(APPENDED)
  })

  it('validates an edit against the published form', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    // Blanking a required answer is not an edit the form allows.
    const response = await editSubmission(cookie, submissionId, {
      title: 'Taming 40-Minute CI',
      answers: { ...SEEDED_TALK_ANSWERS, abstract: '' },
    })
    expect(response.status).toBe(400)
  })

  it('never lets one speaker edit another speaker’s proposal', async () => {
    const { submissionId } = await speakerWithSubmission()
    const stranger = await submitterCookie(env.DB, {}, 'stranger@example.test')
    const response = await editSubmission(stranger, submissionId, {
      title: 'Hijacked',
      answers: SEEDED_TALK_ANSWERS,
    })
    // A safe 404: a stranger learns nothing about whether the id exists.
    expect(response.status).toBe(404)
  })
})

describe('closing the call locks editing too', () => {
  it('reports the submission no longer editable and refuses the write', async () => {
    const { cookie, submissionId } = await speakerWithSubmission()
    const organizer = await organizerCookie()
    expect((await setWindow(organizer, { opensAt: null, closesAt: PAST })).status).toBe(200)

    const detail = await app.request(
      `/api/public/submission/${submissionId}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    // Still readable — a speaker can always see what they sent.
    expect(detail.status).toBe(200)
    expect(((await detail.json()) as { editable: boolean }).editable).toBe(false)

    const write = await editSubmission(cookie, submissionId, {
      title: 'Taming 40-Minute CI',
      answers: { ...SEEDED_TALK_ANSWERS, abstract: 'Sneaking a change in after the deadline.' },
    })
    expect(write.status).toBe(409)

    // And nothing changed underneath.
    const reread = await app.request(
      `/api/public/submission/${submissionId}`,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(((await reread.json()) as { answers: Record<string, string> }).answers.abstract).toBe(
      SEEDED_TALK_ANSWERS.abstract,
    )
  })
})
