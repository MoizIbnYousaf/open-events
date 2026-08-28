import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import app from '../../src/server'
import {
  DEMO_CONF_2026_FORM_ID,
  DEMO_CONF_2026_ID,
  DEMO_CONF_2026_VERSION_ID,
} from '../../src/db/seed'
import { createSubmissionDeskRepository } from '../../src/db/submission-desk-repository'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import { bindings, cookieHeader, loginOrganizer } from './m2c-helpers'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)`).bind(
      'contact-desk-a',
      'ada.desk@example.test',
      'Ada Desk',
      '2026-08-08T10:00:00.000Z',
    ),
    env.DB.prepare(`INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)`).bind(
      'contact-desk-b',
      'grace.desk@example.test',
      'Grace Desk',
      '2026-08-08T10:00:00.000Z',
    ),
    env.DB.prepare(`INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)`).bind(
      'contact-desk-co',
      'co.desk@example.test',
      'Co Speaker',
      '2026-08-08T10:00:00.000Z',
    ),
    env.DB.prepare(
      `INSERT INTO proposal_submissions
           (id, event_id, owner_contact_id, form_version_id, origin_draft_id,
            status, source, title, answers_json, content_hash, routing_json, created_at, submitted_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 'cfp', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      'submission-desk-a',
      DEMO_CONF_2026_ID,
      'contact-desk-a',
      DEMO_CONF_2026_VERSION_ID,
      'draft-desk-a',
      'Applied AI',
      JSON.stringify({
        format: 'Talk',
        track: 'AI Engineering',
        audience_level: 'Advanced',
      }),
      'a'.repeat(64),
      JSON.stringify({ actionKind: 'assign_track', actionTarget: 'ai' }),
      '2026-08-08T11:00:00.000Z',
      '2026-08-08T12:00:00.000Z',
    ),
    env.DB.prepare(
      `INSERT INTO proposal_submissions
           (id, event_id, owner_contact_id, form_version_id, origin_draft_id,
            status, source, title, answers_json, content_hash, routing_json, created_at, submitted_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 'cfp', ?, ?, ?, NULL, ?, ?)`,
    ).bind(
      'submission-desk-b',
      DEMO_CONF_2026_ID,
      'contact-desk-b',
      DEMO_CONF_2026_VERSION_ID,
      'draft-desk-b',
      'Reliable systems',
      JSON.stringify({
        format: 'Workshop',
        track: 'Platform & Infra',
        audience_level: 'Intermediate',
      }),
      'b'.repeat(64),
      '2026-08-09T11:00:00.000Z',
      '2026-08-09T12:00:00.000Z',
    ),
    env.DB.prepare(
      `INSERT INTO submission_contributors
           (event_id, submission_id, contact_id, role, position) VALUES (?, ?, ?, 'primary', 0)`,
    ).bind(DEMO_CONF_2026_ID, 'submission-desk-a', 'contact-desk-a'),
    env.DB.prepare(
      `INSERT INTO submission_contributors
           (event_id, submission_id, contact_id, role, position) VALUES (?, ?, ?, 'co-speaker', 1)`,
    ).bind(DEMO_CONF_2026_ID, 'submission-desk-a', 'contact-desk-co'),
    env.DB.prepare(
      `INSERT INTO submission_contributors
           (event_id, submission_id, contact_id, role, position) VALUES (?, ?, ?, 'primary', 0)`,
    ).bind(DEMO_CONF_2026_ID, 'submission-desk-b', 'contact-desk-b'),
    env.DB.prepare(
      `INSERT INTO submission_decisions
           (event_id, id, submission_id, sequence, outcome, decided_by, decided_at)
         VALUES (?, ?, ?, 1, 'accepted', 'organizer', ?)`,
    ).bind(DEMO_CONF_2026_ID, 'decision-desk-a', 'submission-desk-a', '2026-08-10T12:00:00.000Z'),
  ])
})

describe('submission desk repository', () => {
  it('hydrates the event list and immutable bounded-choice definitions', async () => {
    const source = await createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID)

    expect(source.records).toHaveLength(2)
    expect(
      source.records.every((record) => record.formVersionId === DEMO_CONF_2026_VERSION_ID),
    ).toBe(true)
    expect(source.records.map((record) => record.item)).toEqual([
      expect.objectContaining({
        id: 'submission-desk-b',
        formId: DEMO_CONF_2026_FORM_ID,
        formSlug: 'cfp',
        version: 1,
        primarySpeaker: expect.objectContaining({
          contactId: 'contact-desk-b',
          name: 'Grace Desk',
          email: 'grace.desk@example.test',
        }),
        coSpeakerCount: 0,
        decision: 'pending',
      }),
      expect.objectContaining({
        id: 'submission-desk-a',
        primarySpeaker: expect.objectContaining({ name: 'Ada Desk' }),
        coSpeakerCount: 1,
        decision: 'accepted',
      }),
    ])
    expect(source.records[0]?.answers).toMatchObject({ format: 'Workshop' })
    expect(source.choiceFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementId: 'f0000000-0000-4000-8000-000000000201',
          formId: DEMO_CONF_2026_FORM_ID,
          versionId: DEMO_CONF_2026_VERSION_ID,
          formSlug: 'cfp',
          fieldKey: 'format',
          label: 'Session format',
          questionType: 'single_choice',
          version: 1,
        }),
        expect.objectContaining({
          fieldKey: 'track',
          questionType: 'single_choice',
        }),
      ]),
    )
    expect(source.choiceFields.some((field) => field.fieldKey === 'abstract')).toBe(false)
  })

  it('cannot return direct sessions or rows from another event', async () => {
    const source = await createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID)
    expect(source.records.every((record) => record.item.source === 'cfp')).toBe(true)
    expect(await createSubmissionDeskRepository(env.DB).listByEvent('event-missing')).toEqual({
      records: [],
      choiceFields: [],
      total: 0,
      truncated: false,
    })
  })

  it('fails closed when a submission has no primary contributor', async () => {
    await env.DB.prepare(
      `DELETE FROM submission_contributors
        WHERE event_id = ? AND submission_id = ? AND role = 'primary'`,
    )
      .bind(DEMO_CONF_2026_ID, 'submission-desk-a')
      .run()

    await expect(
      createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID),
    ).rejects.toThrow(/could not hydrate every submission/i)
  })

  it('uses the same fixed statement count for two and fifty rows', async () => {
    function countingDb() {
      let prepares = 0
      const proxy = new Proxy(env.DB, {
        get(target, prop, receiver) {
          if (prop === 'prepare') {
            return (...args: unknown[]) => {
              prepares += 1
              return Reflect.apply(
                target.prepare as unknown as (...values: unknown[]) => unknown,
                target,
                args,
              )
            }
          }
          const value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }) as D1Database
      return { db: proxy, prepares: () => prepares }
    }

    const first = countingDb()
    expect(
      (await createSubmissionDeskRepository(first.db).listByEvent(DEMO_CONF_2026_ID)).records,
    ).toHaveLength(2)
    expect(first.prepares()).toBe(3)

    const statements = Array.from({ length: 48 }, (_, index) => {
      const id = `submission-desk-extra-${index}`
      return [
        env.DB.prepare(
          `INSERT INTO proposal_submissions
               (id, event_id, owner_contact_id, form_version_id, origin_draft_id,
                status, source, title, answers_json, content_hash, routing_json,
                created_at, submitted_at)
             VALUES (?, ?, 'contact-desk-a', ?, ?, 'pending', 'cfp', ?, ?, ?, NULL, ?, ?)`,
        ).bind(
          id,
          DEMO_CONF_2026_ID,
          DEMO_CONF_2026_VERSION_ID,
          `draft-desk-extra-${index}`,
          `Extra proposal ${index}`,
          JSON.stringify({ format: 'Talk', track: 'AI Engineering' }),
          String(index).padStart(64, '0'),
          '2026-08-11T11:00:00.000Z',
          '2026-08-11T12:00:00.000Z',
        ),
        env.DB.prepare(
          `INSERT INTO submission_contributors
               (event_id, submission_id, contact_id, role, position)
             VALUES (?, ?, 'contact-desk-a', 'primary', 0)`,
        ).bind(DEMO_CONF_2026_ID, id),
      ]
    }).flat()
    await env.DB.batch(statements)

    const second = countingDb()
    expect(
      (await createSubmissionDeskRepository(second.db).listByEvent(DEMO_CONF_2026_ID)).records,
    ).toHaveLength(50)
    expect(second.prepares()).toBe(3)
  })
})

describe('organizer submission desk API', () => {
  it('returns a filtered, paginated desk without changing the legacy array endpoint', async () => {
    const token = (await loginOrganizer()).token ?? ''
    const facets = encodeURIComponent(
      JSON.stringify([
        {
          elementId: 'f0000000-0000-4000-8000-000000000201',
          values: ['Talk'],
        },
      ]),
    )
    const desk = await app.request(
      `/api/admin/events/demo-conf-2026/submission-desk?q=AI&decision=accepted&facets=${facets}`,
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )

    expect(desk.status).toBe(200)
    expect(await desk.json()).toMatchObject({
      total: 2,
      matchingTotal: 1,
      page: 1,
      pageSize: 50,
      pageCount: 1,
      truncated: false,
      invalidFacetSelections: [],
      rows: [expect.objectContaining({ id: 'submission-desk-a', decision: 'accepted' })],
      facetCounts: expect.arrayContaining([
        expect.objectContaining({
          elementId: 'f0000000-0000-4000-8000-000000000201',
          versionId: DEMO_CONF_2026_VERSION_ID,
          fieldKey: 'format',
        }),
      ]),
    })

    const legacy = await app.request(
      '/api/admin/events/demo-conf-2026/submissions',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(legacy.status).toBe(200)
    expect(Array.isArray(await legacy.json())).toBe(true)
  })

  it('rejects malformed direct query input instead of silently changing it', async () => {
    const token = (await loginOrganizer()).token ?? ''
    const response = await app.request(
      '/api/admin/events/demo-conf-2026/submission-desk?decision=maybe&page=zero',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })
  })

  it('keeps the desk organizer-only and event-scoped', async () => {
    const anonymous = await app.request(
      '/api/admin/events/demo-conf-2026/submission-desk',
      {},
      bindings(),
    )
    expect(anonymous.status).toBe(401)

    const token = (await loginOrganizer()).token ?? ''
    const missing = await app.request(
      '/api/admin/events/not-an-event/submission-desk',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(missing.status).toBe(404)
  })
})
