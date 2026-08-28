import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import app from '../../src/server'
import { createProgrammeTimelineRepository } from '../../src/db/programme-timeline-repository'
import { DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db/seed'
import { applyMigrations, seedDemoConf, seedDemoConfShowcase } from './m2b-helpers'
import { bindings, cookieHeader, loginOrganizer } from './m2c-helpers'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
  await seedDemoConfShowcase(env.DB)
})

describe('programme timeline repository', () => {
  it('projects every persisted lifecycle lane without exposing recipient addresses', async () => {
    await env.DB.prepare(
      `INSERT INTO captured_messages
         (id, event_id, to_email, subject, body, created_at, submission_id, kind)
       VALUES ('timeline-private-subject', ?, 'recipient@example.test',
               'Follow up with recipient@example.test', 'private body',
               '2026-08-28T12:00:00.000Z', NULL, 'confirmation')`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()

    const source = await createProgrammeTimelineRepository(env.DB).listLatest(DEMO_CONF_2026_ID)
    const categories = new Set(source.items.map((item) => item.category))
    const kinds = new Set(source.items.map((item) => item.kind))

    expect(categories).toEqual(
      new Set(['submissions', 'reviews', 'decisions', 'onboarding', 'communications', 'schedule']),
    )
    expect(kinds.has('proposal_submitted')).toBe(true)
    expect(kinds.has('direct_session_created')).toBe(true)
    expect(kinds.has('review_assigned')).toBe(true)
    expect(kinds.has('review_recused')).toBe(true)
    expect(kinds.has('review_saved')).toBe(true)
    expect(kinds.has('decision_accepted')).toBe(true)
    expect(kinds.has('decision_rejected')).toBe(true)
    expect(kinds.has('speaker_task_assigned')).toBe(true)
    expect(kinds.has('speaker_task_completed')).toBe(true)
    expect(kinds.has('schedule_current')).toBe(true)
    expect(
      [...kinds].some((kind) =>
        ['confirmation_recorded', 'acceptance_recorded', 'reminder_recorded'].includes(kind),
      ),
    ).toBe(true)
    expect(JSON.stringify(source.items)).not.toContain('@example.test')
    expect(source.truncatedCategories).toEqual([])
  })

  it('keeps every source event-scoped', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events (id, slug, name, timezone, status)
         VALUES ('timeline-other', 'timeline-other', 'Other event', 'UTC', 'draft')`,
      ),
      env.DB.prepare(
        `INSERT INTO captured_messages
           (id, event_id, to_email, subject, body, created_at, submission_id, kind)
         VALUES ('timeline-other-message', 'timeline-other', 'other@example.test',
                 'Other event secret', 'hidden', '2026-08-28T12:00:00.000Z', NULL, 'confirmation')`,
      ),
    ])

    const source = await createProgrammeTimelineRepository(env.DB).listLatest(DEMO_CONF_2026_ID)
    expect(source.items.some((item) => item.detail.includes('Other event secret'))).toBe(false)
  })

  it('never treats a provisional email-shaped contact name as display copy', async () => {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE contacts SET name = email
          WHERE id = 'c0000000-0000-4000-8000-000000000601'`,
      ),
      env.DB.prepare(
        `UPDATE contacts SET name = email
            WHERE id IN (SELECT contact_id FROM speaker_tasks WHERE event_id = ?)`,
      ).bind(DEMO_CONF_2026_ID),
    ])

    const source = await createProgrammeTimelineRepository(env.DB).listLatest(DEMO_CONF_2026_ID)
    const review = source.items.find((item) => item.kind === 'review_assigned')
    const onboarding = source.items.find((item) => item.kind === 'speaker_task_assigned')
    expect(review?.detail).toContain('Reviewer')
    expect(onboarding?.detail).toContain('Speaker')
    expect(JSON.stringify([review, onboarding])).not.toContain('@example.test')
  })

  it('uses the same fixed ten statements before and after the event grows', async () => {
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
    await createProgrammeTimelineRepository(first.db).listLatest(DEMO_CONF_2026_ID)
    expect(first.prepares()).toBe(10)

    const statements = Array.from({ length: 40 }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO proposal_submissions
             (id, event_id, owner_contact_id, form_version_id, origin_draft_id,
              status, source, title, answers_json, content_hash, routing_json,
              created_at, submitted_at)
           VALUES (?, ?, 'c0000000-0000-4000-8000-000000000604', ?, ?,
                   'pending', 'cfp', ?, '{}', ?, NULL, ?, ?)`,
      ).bind(
        `timeline-submission-${index}`,
        DEMO_CONF_2026_ID,
        DEMO_CONF_2026_VERSION_ID,
        `timeline-draft-${index}`,
        `Timeline proposal ${index}`,
        index.toString().padStart(64, '0'),
        '2026-08-20T10:00:00.000Z',
        `2026-08-${(20 + (index % 8)).toString().padStart(2, '0')}T12:00:00.000Z`,
      ),
    )
    await env.DB.batch(statements)

    const second = countingDb()
    await createProgrammeTimelineRepository(second.db).listLatest(DEMO_CONF_2026_ID)
    expect(second.prepares()).toBe(10)
  })
})

describe('organizer programme timeline API', () => {
  it('returns a bounded projection and applies the requested category before the cap', async () => {
    const token = (await loginOrganizer()).token ?? ''
    const all = await app.request(
      '/api/admin/events/demo-conf-2026/timeline',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(all.status).toBe(200)
    expect(await all.json()).toMatchObject({
      category: 'all',
      limit: 100,
      truncated: false,
      items: expect.arrayContaining([
        expect.objectContaining({ category: 'submissions' }),
        expect.objectContaining({ category: 'schedule' }),
      ]),
    })

    const communications = await app.request(
      '/api/admin/events/demo-conf-2026/timeline?category=communications',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(communications.status).toBe(200)
    const body = (await communications.json()) as {
      category: string
      items: Array<{ category: string }>
    }
    expect(body.category).toBe('communications')
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((item) => item.category === 'communications')).toBe(true)
  })

  it('rejects malformed filters and keeps the projection organizer-only and event-scoped', async () => {
    const anonymous = await app.request('/api/admin/events/demo-conf-2026/timeline', {}, bindings())
    expect(anonymous.status).toBe(401)

    const token = (await loginOrganizer()).token ?? ''
    const malformed = await app.request(
      '/api/admin/events/demo-conf-2026/timeline?category=everything',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(malformed.status).toBe(400)

    const missing = await app.request(
      '/api/admin/events/not-an-event/timeline',
      { headers: { cookie: cookieHeader(token) } },
      bindings(),
    )
    expect(missing.status).toBe(404)
  })
})
