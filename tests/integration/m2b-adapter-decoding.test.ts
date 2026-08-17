import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import {
  createCapturedMessageRepository as createD1CapturedMessageRepository,
  createConfirmationRepository,
  createContactRepository,
  createDraftRepository,
  createEventConfigRepository,
  createFormContentRepository,
  createFormRepository,
  createFormVersionRepository,
  createSessionRepository,
  createSubmissionRepository,
  createTaxonomyRepository,
  createTokenRepository,
  DEMO_CONF_2026_CONTENT_HASH,
  DEMO_CONF_2026_FORM_ID,
  DEMO_CONF_2026_ID,
  DEMO_CONF_2026_PUBLISHED_AT,
  DEMO_CONF_2026_VERSION_ID,
} from '../../src/db'
import { NOW } from '../unit/helpers/fixtures'
import { TEST_EMAIL_DELIVERY_CONFIG, applyMigrations, seedDemoConf } from './m2b-helpers'

const createCapturedMessageRepository = (db: D1Database) =>
  createD1CapturedMessageRepository(db, TEST_EMAIL_DELIVERY_CONFIG)

const FUTURE = '2026-12-31T23:59:59.000Z'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

describe('D1 adapter row decoding round-trips', () => {
  it('decodes the seeded event, form, version, content, and taxonomy', async () => {
    const event = await createEventConfigRepository(env.DB).findBySlug('demo-conf-2026')
    expect(event).toMatchObject({
      id: DEMO_CONF_2026_ID,
      slug: 'demo-conf-2026',
      name: 'DemoConf 2026',
      timezone: 'Europe/Berlin',
      status: 'draft',
      websiteUrl: 'https://example.test/demo-conf-2026',
      organizerContact: 'programme@example.test',
      venue: 'DemoConf Convention Center, Berlin',
      eventType: 'conference',
    })
    expect(event?.dates).toEqual({
      startsAt: '2026-05-13T08:00:00.000Z',
      endsAt: '2026-05-15T17:00:00.000Z',
    })

    const form = await createFormRepository(env.DB).findByEventAndSlug(DEMO_CONF_2026_ID, 'cfp')
    expect(form).toMatchObject({
      id: DEMO_CONF_2026_FORM_ID,
      eventId: DEMO_CONF_2026_ID,
      slug: 'cfp',
      status: 'published',
      publishedVersionId: DEMO_CONF_2026_VERSION_ID,
      limits: {
        opensAt: '2026-01-01T00:00:00.000Z',
        closesAt: '2026-12-31T23:59:59.000Z',
        totalCap: 100,
        perIdentityLimit: 3,
      },
    })

    const version = await createFormVersionRepository(env.DB).findById(DEMO_CONF_2026_VERSION_ID)
    expect(version).toMatchObject({
      id: DEMO_CONF_2026_VERSION_ID,
      formId: DEMO_CONF_2026_FORM_ID,
      version: 1,
      status: 'published',
      contentHash: DEMO_CONF_2026_CONTENT_HASH,
      publishedAt: DEMO_CONF_2026_PUBLISHED_AT,
    })

    const content = await createFormContentRepository(env.DB).loadByVersion(
      DEMO_CONF_2026_ID,
      DEMO_CONF_2026_VERSION_ID,
    )
    expect(content.pages.map((page) => page.position)).toEqual([0, 1, 2, 3])
    // Sorted: this case is about faithful DECODING, and element order is the
    // content loader's contract, asserted where that ordering matters.
    expect([...content.elements.map((element) => element.fieldKey)].sort()).toEqual([
      'abstract',
      'audience_level',
      'company',
      'format',
      'job_title',
      'key_takeaway',
      'speaker_bio',
      'track',
      'workshop_details',
    ])
    // The conditional question carries both effects, so it decodes to two rules.
    expect(content.conditionRules).toHaveLength(2)
    expect([...content.conditionRules].map((rule) => rule.effect).sort()).toEqual([
      'require',
      'show',
    ])
    for (const rule of content.conditionRules) {
      expect(rule.groups).toEqual([
        {
          groupIndex: 0,
          conditions: [{ operator: 'eq', operandKey: 'format', value: 'Workshop' }],
        },
      ])
    }
    expect(content.routingRules).toHaveLength(1)
    expect(content.routingRules[0]).toMatchObject({
      actionKind: 'assign_track',
      actionTarget: 'platform-infra',
    })

    const taxonomy = await createTaxonomyRepository(env.DB).listByEvent(DEMO_CONF_2026_ID)
    expect(taxonomy.map((item) => `${item.kind}:${item.key}`)).toEqual([
      // Taxonomy position IS the order the published form offers, now that the
      // format question takes its choices from this vocabulary rather than
      // keeping a second copy that could disagree with it.
      'format:talk',
      'format:workshop',
      'format:lightning-talk',
      'room:main-hall',
      'room:workshop-a',
      'track:platform-infra',
      'track:ai-engineering',
      'track:developer-experience',
    ])
  })

  it('round-trips draft, submission, contributors, message, confirmation, token, and session rows', async () => {
    await env.DB.prepare(
      `INSERT INTO contacts (id, email, name, created_at) VALUES
         ('contact-owner', 'owner@example.test', 'Owner', ?),
         ('contact-co', 'co@example.test', 'Co', ?)`,
    )
      .bind(NOW, NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO proposal_drafts (id, event_id, owner_contact_id, form_version_id,
                                      title, answers_json, created_at, updated_at)
         VALUES ('draft-1', ?, 'contact-owner', ?, 'Draft', '{"format":"workshop"}', ?, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID, NOW, NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO proposal_submissions (id, event_id, owner_contact_id, form_version_id,
                                           origin_draft_id, status, title, answers_json,
                                           content_hash, routing_json, created_at, submitted_at)
         VALUES ('submission-1', ?, 'contact-owner', ?, 'draft-1', 'pending', 'Talk',
                 '{"format":"talk"}', ?, '{"actionKind":"assign_track","actionTarget":"talk"}',
                 ?, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID, 'a'.repeat(64), NOW, NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO submission_contributors (event_id, submission_id, contact_id, role, position)
         VALUES (?, 'submission-1', 'contact-owner', 'primary', 0),
                (?, 'submission-1', 'contact-co', 'co-speaker', 1)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_ID)
      .run()
    await env.DB.prepare(
      `INSERT INTO captured_messages (id, event_id, to_email, subject, body, created_at)
         VALUES ('message-1', ?, 'owner@example.test', 'subject', 'body', ?)`,
    )
      .bind(DEMO_CONF_2026_ID, NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO confirmation_records (id, event_id, submission_id, captured_message_id, created_at)
         VALUES ('confirmation-1', ?, 'submission-1', 'message-1', ?)`,
    )
      .bind(DEMO_CONF_2026_ID, NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO submitter_tokens (id, event_id, contact_id, form_id, token_hash,
                                       expires_at, consumed_at, created_at)
         VALUES ('token-1', ?, 'contact-owner', ?, ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, DEMO_CONF_2026_FORM_ID, 'a'.repeat(64), FUTURE, NOW)
      .run()

    const draft = await createDraftRepository(env.DB).findById('draft-1')
    expect(draft).toMatchObject({
      id: 'draft-1',
      eventId: DEMO_CONF_2026_ID,
      ownerContactId: 'contact-owner',
      formVersionId: DEMO_CONF_2026_VERSION_ID,
      title: 'Draft',
      answers: { format: 'workshop' },
    })

    const submission = await createSubmissionRepository(env.DB).findById('submission-1')
    expect(submission).toMatchObject({
      id: 'submission-1',
      originDraftId: 'draft-1',
      status: 'pending',
      title: 'Talk',
      answers: { format: 'talk' },
      contentHash: 'a'.repeat(64),
      routing: { actionKind: 'assign_track', actionTarget: 'talk' },
    })
    const contributors = await createSubmissionRepository(env.DB).listContributorsBySubmission(
      DEMO_CONF_2026_ID,
      'submission-1',
    )
    expect(contributors.map((row) => [row.role, row.position])).toEqual([
      ['primary', 0],
      ['co-speaker', 1],
    ])

    expect(
      await createCapturedMessageRepository(env.DB).listByEmail('owner@example.test'),
    ).toHaveLength(1)
    expect(
      await createConfirmationRepository(env.DB).findBySubmissionId('submission-1'),
    ).toMatchObject({ submissionId: 'submission-1', capturedMessageId: 'message-1' })
    expect(await createTokenRepository(env.DB).findByHash('a'.repeat(64))).toMatchObject({
      id: 'token-1',
      contactId: 'contact-owner',
      eventId: DEMO_CONF_2026_ID,
    })
    expect(await createContactRepository(env.DB).findByEmail('co@example.test')).toMatchObject({
      id: 'contact-co',
      email: 'co@example.test',
    })

    const sessionRepository = createSessionRepository(env.DB)
    await sessionRepository.save({
      id: 'session-sub',
      kind: 'submitter',
      contactId: 'contact-owner',
      eventId: DEMO_CONF_2026_ID,
      capability: 'portal',
      tokenHash: 'b'.repeat(64),
      expiresAt: FUTURE,
      consumedAt: null,
      createdAt: NOW,
      provenance: 'ordinary',
    })
    const decoded = await sessionRepository.findByHash('b'.repeat(64))
    expect(decoded).toMatchObject({
      kind: 'submitter',
      contactId: 'contact-owner',
      eventId: DEMO_CONF_2026_ID,
    })
  })
})
