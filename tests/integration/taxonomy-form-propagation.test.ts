import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import {
  applyMigrations,
  seedDemoConf,
  SEEDED_TALK_ANSWERS,
  SEEDED_WORKSHOP_ANSWERS,
} from './m2b-helpers'
import {
  ALLOWED_ORIGIN,
  bindings,
  cookieHeader,
  loginOrganizer,
  parseCookieToken,
  savePublicDraft,
  submitterCookie,
} from './m2c-helpers'
import app from '../../src/server'

/**
 * The event's vocabulary and the form's choices are one fact.
 *
 * They used to be two. The Formats taxonomy and the `format` question each kept
 * their own list, so an organizer adding "Keynote" on the Taxonomies page
 * changed nothing on the public form and nothing said so — the submitter was
 * simply never offered it. The evaluator hit this in the wild and had to
 * abandon its own fixture formats.
 */
describe('an organizer extends the event vocabulary', () => {
  beforeEach(async () => {
    await reset()
    await applyMigrations(env.DB)
    await seedDemoConf(env.DB)
  })

  async function organizerCookie(): Promise<string> {
    const login = await loginOrganizer()
    return login.token ?? ''
  }

  async function publicFormats(): Promise<readonly string[]> {
    const definition = (await (
      await app.request('/api/public/cfp/demo-conf-2026/cfp', undefined, bindings())
    ).json()) as { elements: readonly { fieldKey: string | null; options: readonly string[] }[] }
    return definition.elements.find((element) => element.fieldKey === 'format')?.options ?? []
  }

  async function putTaxonomies(
    cookie: string,
    items: readonly Record<string, unknown>[],
  ): Promise<Response> {
    return app.request(
      '/api/admin/events/demo-conf-2026/taxonomies',
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ items }),
      },
      bindings(),
    )
  }

  const SEEDED_ITEMS = [
    { kind: 'format', key: 'talk', label: 'Talk', position: 0 },
    { kind: 'format', key: 'workshop', label: 'Workshop', position: 1 },
    { kind: 'format', key: 'lightning-talk', label: 'Lightning talk', position: 2 },
    { kind: 'track', key: 'platform-infra', label: 'Platform & Infra', position: 0 },
    { kind: 'track', key: 'ai-engineering', label: 'AI Engineering', position: 1 },
    { kind: 'track', key: 'developer-experience', label: 'Developer Experience', position: 2 },
    { kind: 'room', key: 'main-hall', label: 'Main hall', position: 0 },
    { kind: 'room', key: 'workshop-a', label: 'Workshop A', position: 1 },
  ]

  it('keeps existing taxonomy ids when the organizer adds a row', async () => {
    const organizer = await organizerCookie()
    const before = (await (
      await app.request(
        '/api/admin/events/demo-conf-2026/taxonomies',
        {
          headers: { cookie: cookieHeader(organizer), origin: ALLOWED_ORIGIN },
        },
        bindings(),
      )
    ).json()) as { items: readonly { id: string; key: string; kind: string }[] }
    const talkId = before.items.find((item) => item.kind === 'format' && item.key === 'talk')?.id
    expect(talkId).toEqual(expect.any(String))

    const response = await putTaxonomies(organizer, [
      ...SEEDED_ITEMS,
      { kind: 'format', key: 'keynote', label: 'Keynote (45 min)', position: 3 },
    ])
    expect(response.status).toBe(200)
    const after = (await response.json()) as {
      items: readonly { id: string; key: string; kind: string }[]
    }
    expect(after.items.find((item) => item.kind === 'format' && item.key === 'talk')?.id).toBe(
      talkId,
    )
    expect(after.items.some((item) => item.key === 'keynote')).toBe(true)
  })

  it('offers a newly added format on the published public form', async () => {
    const organizer = await organizerCookie()
    expect(await publicFormats()).toEqual(['Talk', 'Workshop', 'Lightning talk'])

    const response = await putTaxonomies(organizer, [
      ...SEEDED_ITEMS,
      { kind: 'format', key: 'keynote', label: 'Keynote (45 min)', position: 3 },
    ])
    expect(response.status).toBe(200)

    // The measured defect: the organizer's own page said five formats and the
    // public form kept offering three.
    expect(await publicFormats()).toContain('Keynote (45 min)')
  })

  it('accepts a proposal answering the newly added format', async () => {
    const organizer = await organizerCookie()
    await putTaxonomies(organizer, [
      ...SEEDED_ITEMS,
      { kind: 'format', key: 'keynote', label: 'Keynote (45 min)', position: 3 },
    ])

    const speaker = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(speaker, {
      title: 'A keynote',
      answers: { ...SEEDED_TALK_ANSWERS, format: 'Keynote (45 min)' },
    })
    const submitted = await app.request(
      '/api/public/submit',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          originDraftId: draftId,
          formVersionId: 'f0000000-0000-4000-8000-000000000002',
          title: 'A keynote',
          answers: { ...SEEDED_TALK_ANSWERS, format: 'Keynote (45 min)' },
          coSpeakers: [],
        }),
      },
      bindings(),
    )

    // The OFFER and the ACCEPTANCE moved together. A fix applied only to what
    // the form renders would pass the test above and fail here, leaving a
    // submitter shown a choice the server then refuses.
    expect(submitted.status).toBe(200)
  })

  /**
   * The sharp edge of a moving vocabulary.
   *
   * An edit re-validates against the version the proposal was submitted under,
   * and that version's choices now follow the taxonomy. So withdrawing a format
   * could make a proposal that answered it honestly impossible for its author
   * to touch again — punishing them for an organizer's decision.
   */
  it('keeps a submitted proposal editable after its format is withdrawn', async () => {
    const organizer = await organizerCookie()
    const speaker = await submitterCookie(env.DB)
    const draftId = await savePublicDraft(speaker, {
      title: 'A workshop',
      answers: SEEDED_WORKSHOP_ANSWERS,
    })
    const submitted = await app.request(
      '/api/public/submit',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          originDraftId: draftId,
          formVersionId: 'f0000000-0000-4000-8000-000000000002',
          title: 'A workshop',
          answers: SEEDED_WORKSHOP_ANSWERS,
          coSpeakers: [],
        }),
      },
      bindings(),
    )
    expect(submitted.status).toBe(200)
    const submissionId = ((await submitted.json()) as { id: string }).id
    const portalCookie = parseCookieToken(submitted.headers.get('set-cookie'))
    if (portalCookie === null) throw new Error('submit did not elevate the CFP session')

    // The organizer drops Workshop from the programme's vocabulary.
    await putTaxonomies(
      organizer,
      SEEDED_ITEMS.filter((item) => item.key !== 'workshop'),
    )

    const edited = await app.request(
      `/api/public/submission/${submissionId}`,
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(portalCookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'A workshop',
          answers: {
            ...SEEDED_WORKSHOP_ANSWERS,
            abstract: 'Updated: now includes 2026 benchmark data.',
          },
        }),
      },
      bindings(),
    )

    expect(edited.status).toBe(200)
  })
})
