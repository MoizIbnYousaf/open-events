import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import app from '../../src/server'
import type { SubmissionDeskQuery } from '../../src/application/dtos/submission-desk.dto'
import {
  DEMO_CONF_2026_FORM_ID,
  DEMO_CONF_2026_ID,
  DEMO_CONF_2026_VERSION_ID,
} from '../../src/db/seed'
import { createSubmissionDeskRepository } from '../../src/db/submission-desk-repository'
import { applyMigrations, seedDemoConf } from './m2b-helpers'
import { ALLOWED_ORIGIN, bindings, cookieHeader, loginOrganizer } from './m2c-helpers'

const DEFAULT_QUERY: SubmissionDeskQuery = {
  q: '',
  decision: 'all',
  routing: 'all',
  sort: 'submitted-desc',
  page: 1,
  facets: [],
}

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
    const source = await createSubmissionDeskRepository(env.DB).listByEvent(
      DEMO_CONF_2026_ID,
      DEFAULT_QUERY,
    )

    expect(source.records).toHaveLength(2)
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
    expect(source.facetCounts).toEqual(
      expect.arrayContaining([
        { elementId: 'f0000000-0000-4000-8000-000000000201', value: 'Talk', count: 1 },
        { elementId: 'f0000000-0000-4000-8000-000000000201', value: 'Workshop', count: 1 },
      ]),
    )
  })

  it('cannot return direct sessions or rows from another event', async () => {
    const source = await createSubmissionDeskRepository(env.DB).listByEvent(
      DEMO_CONF_2026_ID,
      DEFAULT_QUERY,
    )
    expect(source.records.every((record) => record.item.source === 'cfp')).toBe(true)
    expect(
      await createSubmissionDeskRepository(env.DB).listByEvent('event-missing', DEFAULT_QUERY),
    ).toEqual({
      records: [],
      choiceFields: [],
      facetCounts: [],
      routingOptions: [],
      total: 0,
      matchingTotal: 0,
      page: 1,
      pageCount: 0,
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
      createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID, DEFAULT_QUERY),
    ).rejects.toThrow(/could not hydrate every event submission/i)
  })

  it('does not expose fields from a draft version with no submitted proposal', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO cfp_form_versions
             (event_id, id, form_id, version, status, content_hash, published_at, updated_at)
           VALUES (?, 'desk-draft-version', ?, 2, 'draft', NULL, NULL, ?)`,
      ).bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_FORM_ID, '2026-08-28T12:00:00.000Z'),
      env.DB.prepare(
        `INSERT INTO cfp_pages (event_id, id, version_id, position, kind, title, content)
         VALUES (?, 'desk-draft-page', 'desk-draft-version', 0, 'review', 'Draft', '')`,
      ).bind(DEMO_CONF_2026_ID),
      env.DB.prepare(
        `INSERT INTO cfp_elements
           (event_id, id, version_id, page_id, position, kind, field_key, label,
            required, max_length, question_type, options_json, options_source)
         VALUES (?, 'desk-draft-field', 'desk-draft-version', 'desk-draft-page', 0,
                 'question', 'private_draft_choice', 'Private draft choice', 0,
                 NULL, 'single_choice', '["One","Two"]', NULL)`,
      ).bind(DEMO_CONF_2026_ID),
    ])

    const source = await createSubmissionDeskRepository(env.DB).listByEvent(
      DEMO_CONF_2026_ID,
      DEFAULT_QUERY,
    )
    expect(source.choiceFields.some((field) => field.elementId === 'desk-draft-field')).toBe(false)
  })

  it('finds an exact older match after the event grows beyond one thousand submissions', async () => {
    for (const [start, end] of [
      [1, 600],
      [601, 1_005],
    ] as const) {
      await env.DB.prepare(
        `WITH RECURSIVE sequence(value) AS (
           VALUES (?) UNION ALL SELECT value + 1 FROM sequence WHERE value < ?
         )
         INSERT INTO proposal_submissions
           (id, event_id, owner_contact_id, form_version_id, origin_draft_id,
            status, source, title, answers_json, content_hash, routing_json,
            created_at, submitted_at)
         SELECT 'submission-desk-new-' || printf('%04d', value), ?, 'contact-desk-a', ?,
                'draft-desk-new-' || printf('%04d', value), 'pending', 'cfp',
                'New proposal ' || value, '{"format":"Talk"}', ?, NULL,
                '2026-08-20T11:00:00.000Z', '2026-08-20T12:00:00.000Z'
           FROM sequence`,
      )
        .bind(start, end, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID, 'c'.repeat(64))
        .run()
    }
    await env.DB.prepare(
      `INSERT INTO submission_contributors
         (event_id, submission_id, contact_id, role, position)
       SELECT event_id, id, 'contact-desk-a', 'primary', 0
         FROM proposal_submissions WHERE id LIKE 'submission-desk-new-%'`,
    ).run()

    const source = await createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID, {
      ...DEFAULT_QUERY,
      q: 'Applied AI',
    })
    expect(source.total).toBe(1_007)
    expect(source.matchingTotal).toBe(1)
    expect(source.records.map((record) => record.item.id)).toEqual(['submission-desk-a'])
  })

  it('matches Unicode speaker names without requiring the stored letter case', async () => {
    await env.DB.prepare(
      `UPDATE contacts SET name = 'Élodie Мария' WHERE id = 'contact-desk-a'`,
    ).run()

    for (const q of ['élodie', 'мария']) {
      const source = await createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID, {
        ...DEFAULT_QUERY,
        q,
      })
      expect(source.records.map((record) => record.item.id)).toEqual(['submission-desk-a'])
    }

    await env.DB.prepare(`UPDATE contacts SET name = 'ẞeta Kate' WHERE id = 'contact-desk-a'`).run()
    for (const q of ['ßeta', 'kate']) {
      const source = await createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID, {
        ...DEFAULT_QUERY,
        q,
      })
      expect(source.records.map((record) => record.item.id)).toEqual(['submission-desk-a'])
    }

    await env.DB.prepare(`UPDATE contacts SET name = 'ßeta Kate' WHERE id = 'contact-desk-a'`).run()
    for (const q of ['ẞeta', 'Kate']) {
      const source = await createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID, {
        ...DEFAULT_QUERY,
        q,
      })
      expect(source.records.map((record) => record.item.id)).toEqual(['submission-desk-a'])
    }
  })

  it('returns one atomic snapshot when a match changes after the batch', async () => {
    let metadataBatches = 0
    const proxy = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === 'batch') {
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(
              target.batch as unknown as (...values: unknown[]) => Promise<unknown>,
              target,
              args,
            )
            metadataBatches += 1
            if (metadataBatches === 1) {
              await env.DB.prepare(
                `UPDATE proposal_submissions SET title = 'Changed concurrently' WHERE id = ?`,
              )
                .bind('submission-desk-a')
                .run()
            }
            return result
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as D1Database

    const source = await createSubmissionDeskRepository(proxy).listByEvent(DEMO_CONF_2026_ID, {
      ...DEFAULT_QUERY,
      q: 'Applied AI',
    })
    expect(metadataBatches).toBe(1)
    expect(source.matchingTotal).toBe(1)
    expect(source.records.map((record) => record.item.id)).toEqual(['submission-desk-a'])

    const refreshed = await createSubmissionDeskRepository(env.DB).listByEvent(DEMO_CONF_2026_ID, {
      ...DEFAULT_QUERY,
      q: 'Applied AI',
    })
    expect(refreshed.matchingTotal).toBe(0)
    expect(refreshed.records).toEqual([])
  })

  it('keeps a full page and its totals on one snapshot during a concurrent insert', async () => {
    await env.DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         VALUES (1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 48
       )
       INSERT INTO proposal_submissions
         (id, event_id, owner_contact_id, form_version_id, origin_draft_id,
          status, source, title, answers_json, content_hash, routing_json,
          created_at, submitted_at)
       SELECT 'submission-desk-race-' || printf('%02d', value), ?, 'contact-desk-a', ?,
              'draft-desk-race-' || printf('%02d', value), 'pending', 'cfp',
              'Race proposal ' || value, '{}', printf('%064d', value), NULL,
              '2026-08-20T11:00:00.000Z', '2026-08-20T12:00:00.000Z'
         FROM sequence`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID)
      .run()
    await env.DB.prepare(
      `INSERT INTO submission_contributors
         (event_id, submission_id, contact_id, role, position)
       SELECT event_id, id, 'contact-desk-a', 'primary', 0
         FROM proposal_submissions WHERE id LIKE 'submission-desk-race-%'`,
    ).run()

    let metadataBatches = 0
    const proxy = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === 'batch') {
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(
              target.batch as unknown as (...values: unknown[]) => Promise<unknown>,
              target,
              args,
            )
            metadataBatches += 1
            if (metadataBatches === 1) {
              await env.DB.batch([
                env.DB.prepare(
                  `INSERT INTO proposal_submissions
                     (id, event_id, owner_contact_id, form_version_id, origin_draft_id,
                      status, source, title, answers_json, content_hash, routing_json,
                      created_at, submitted_at)
                   VALUES ('submission-desk-race-new', ?, 'contact-desk-a', ?,
                           'draft-desk-race-new', 'pending', 'cfp', 'Newest race proposal',
                           '{}', ?, NULL, '2026-08-21T11:00:00.000Z',
                           '2026-08-21T12:00:00.000Z')`,
                ).bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID, 'f'.repeat(64)),
                env.DB.prepare(
                  `INSERT INTO submission_contributors
                     (event_id, submission_id, contact_id, role, position)
                   VALUES (?, 'submission-desk-race-new', 'contact-desk-a', 'primary', 0)`,
                ).bind(DEMO_CONF_2026_ID),
              ])
            }
            return result
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as D1Database

    const source = await createSubmissionDeskRepository(proxy).listByEvent(
      DEMO_CONF_2026_ID,
      DEFAULT_QUERY,
    )
    expect(metadataBatches).toBe(1)
    expect(source.total).toBe(50)
    expect(source.matchingTotal).toBe(50)
    expect(source.pageCount).toBe(1)
    expect(source.records).toHaveLength(50)

    const refreshed = await createSubmissionDeskRepository(env.DB).listByEvent(
      DEMO_CONF_2026_ID,
      DEFAULT_QUERY,
    )
    expect(refreshed.total).toBe(51)
    expect(refreshed.matchingTotal).toBe(51)
    expect(refreshed.pageCount).toBe(2)
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
      (await createSubmissionDeskRepository(first.db).listByEvent(DEMO_CONF_2026_ID, DEFAULT_QUERY))
        .records,
    ).toHaveLength(2)
    expect(first.prepares()).toBe(7)

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
      (
        await createSubmissionDeskRepository(second.db).listByEvent(
          DEMO_CONF_2026_ID,
          DEFAULT_QUERY,
        )
      ).records,
    ).toHaveLength(50)
    expect(second.prepares()).toBe(7)
  })
})

describe('organizer submission desk API', () => {
  it('returns a filtered, paginated desk without changing the legacy array endpoint', async () => {
    const token = (await loginOrganizer()).token ?? ''
    const desk = await app.request(
      `/api/admin/events/demo-conf-2026/submission-desk/query`,
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(token),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...DEFAULT_QUERY,
          q: 'AI',
          decision: 'accepted',
          facets: [
            {
              elementId: 'f0000000-0000-4000-8000-000000000201',
              values: ['Talk'],
            },
          ],
        }),
      },
      bindings(),
    )

    expect(desk.status).toBe(200)
    expect(await desk.json()).toMatchObject({
      total: 2,
      matchingTotal: 1,
      page: 1,
      pageSize: 50,
      pageCount: 1,
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

  it('never schedules an email drain for the private read-only POST', async () => {
    const token = (await loginOrganizer()).token ?? ''
    const drains: Promise<unknown>[] = []
    const executionContext = {
      waitUntil(promise: Promise<unknown>) {
        drains.push(promise)
      },
      passThroughOnException() {},
      props: {},
    } as ExecutionContext
    const response = await app.fetch(
      new Request('http://localhost:8787/api/admin/events/demo-conf-2026/submission-desk/query', {
        method: 'POST',
        headers: {
          cookie: cookieHeader(token),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify(DEFAULT_QUERY),
      }),
      bindings({
        EMAIL_DELIVERY_MODE: 'resend-test',
        RESEND_API_KEY: 'test-key',
        EMAIL_FROM: 'Open Events <events@example.test>',
      }),
      executionContext,
    )

    expect(response.status).toBe(200)
    expect(drains).toEqual([])
  })

  it('allows read-only tour authority without allowing a mutation', async () => {
    const tour = await app.request(
      '/api/tour/session',
      { method: 'POST', headers: { origin: ALLOWED_ORIGIN } },
      bindings({ DEPLOY_ENVIRONMENT: 'acceptance' }),
    )
    const token = tour.headers.get('set-cookie')?.match(/sp_tour_session=([^;]+)/)?.[1] ?? ''
    expect(token).not.toBe('')

    const response = await app.request(
      '/api/admin/events/demo-conf-2026/submission-desk/query',
      {
        method: 'POST',
        headers: {
          cookie: `sp_tour_session=${token}`,
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify(DEFAULT_QUERY),
      },
      bindings({ DEPLOY_ENVIRONMENT: 'acceptance' }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ total: 2, matchingTotal: 2 })

    const mutation = await app.request(
      '/api/admin/events/demo-conf-2026/submission-views',
      {
        method: 'POST',
        headers: {
          cookie: `sp_tour_session=${token}`,
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Tour must not save',
          state: {
            schemaVersion: 1,
            decision: 'all',
            routing: 'all',
            sort: 'submitted-desc',
            facets: [],
          },
        }),
      },
      bindings({ DEPLOY_ENVIRONMENT: 'acceptance' }),
    )
    expect(mutation.status).toBe(403)
  })

  it('rejects malformed direct query input instead of silently changing it', async () => {
    const token = (await loginOrganizer()).token ?? ''
    const response = await app.request(
      '/api/admin/events/demo-conf-2026/submission-desk/query',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(token),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...DEFAULT_QUERY, decision: 'maybe', page: 'zero' }),
      },
      bindings(),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })
  })

  it('keeps the desk organizer-only and event-scoped', async () => {
    const anonymous = await app.request(
      '/api/admin/events/demo-conf-2026/submission-desk/query',
      { method: 'POST', headers: { origin: ALLOWED_ORIGIN } },
      bindings(),
    )
    expect(anonymous.status).toBe(401)

    const token = (await loginOrganizer()).token ?? ''
    const missing = await app.request(
      '/api/admin/events/not-an-event/submission-desk/query',
      {
        method: 'POST',
        headers: {
          cookie: cookieHeader(token),
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/json',
        },
        body: JSON.stringify(DEFAULT_QUERY),
      },
      bindings(),
    )
    expect(missing.status).toBe(404)
  })
})
