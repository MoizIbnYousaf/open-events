import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { applyMigrations, seedDemoConf, SEEDED_TALK_ANSWERS } from './m2b-helpers'
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
})
