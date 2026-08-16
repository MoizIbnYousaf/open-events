import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'

import { createSessionUnitOfWork as createD1SessionUnitOfWork } from '../../src/db'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID } from '../../src/db'
import { NOW } from '../unit/helpers/fixtures'
import {
  SEEDED_CONTACTS,
  TEST_EMAIL_DELIVERY_CONFIG,
  applyMigrations,
  countRows,
  expectRejects,
  seedDemoConf,
  testStartMailBudget,
} from './m2b-helpers'

const createSessionUnitOfWork = (db: D1Database) =>
  createD1SessionUnitOfWork(db, TEST_EMAIL_DELIVERY_CONFIG)

const FUTURE = '2026-12-31T23:59:59.000Z'

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

function token(id: string, contactId: string, tokenHash: string) {
  return {
    id,
    contactId,
    eventId: DEMO_CONF_2026_ID,
    formId: DEMO_CONF_2026_FORM_ID,
    purpose: 'cfp' as const,
    tokenHash,
    expiresAt: FUTURE,
    consumedAt: null,
    createdAt: NOW,
  }
}

function startBatchInput(
  suffix: string,
  budget = testStartMailBudget(suffix),
  email = `${suffix}@example.test`,
) {
  return {
    contact: { id: `contact-${suffix}`, email, name: suffix, createdAt: budget.now },
    token: {
      ...token(`token-${suffix}`, `contact-${suffix}`, suffix.padEnd(64, 'a').slice(0, 64)),
      createdAt: budget.now,
    },
    message: {
      id: `message-${suffix}`,
      eventId: DEMO_CONF_2026_ID,
      toEmail: email,
      subject: 'Your Open Events CFP link',
      body: 'Open your CFP session',
      createdAt: budget.now,
      kind: 'confirmation' as const,
    },
    budget,
  }
}

describe('contact dedupe by normalized email', () => {
  it('rejects an issueStart whose token and message disagree on the event, with zero writes', async () => {
    const unitOfWork = createSessionUnitOfWork(env.DB)

    await expect(
      unitOfWork.issueStart({
        contact: { id: 'contact-a', email: 'a@example.test', name: 'A', createdAt: NOW },
        token: {
          id: 'token-a',
          contactId: 'contact-a',
          eventId: 'event-one',
          formId: DEMO_CONF_2026_FORM_ID,
          purpose: 'cfp',
          tokenHash: 'a'.repeat(64),
          expiresAt: FUTURE,
          consumedAt: null,
          createdAt: NOW,
        },
        message: {
          id: 'message-a',
          eventId: 'event-two',
          toEmail: 'a@example.test',
          subject: 's',
          body: 'b',
          createdAt: NOW,
          kind: 'confirmation' as const,
        },
        budget: testStartMailBudget('mismatch'),
      }),
    ).rejects.toThrow(/same eventId/)

    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS)
    expect(await countRows(env.DB, 'submitter_tokens')).toBe(0)
    expect(await countRows(env.DB, 'captured_messages')).toBe(0)
  })

  it('concurrent issueStart calls converge on a single contact row', async () => {
    const unitOfWork = createSessionUnitOfWork(env.DB)
    const email = 'speaker.a@example.test'
    const message = (id: string) => ({
      id,
      eventId: DEMO_CONF_2026_ID,
      toEmail: email,
      subject: 'Your Open Events CFP link',
      body: 'Open your CFP session',
      createdAt: NOW,
      kind: 'confirmation' as const,
    })

    await Promise.all([
      unitOfWork.issueStart({
        contact: { id: 'contact-a', email, name: 'Speaker A', createdAt: NOW },
        token: token('token-a', 'contact-a', 'a'.repeat(64)),
        message: message('message-a'),
        budget: testStartMailBudget('a'),
      }),
      unitOfWork.issueStart({
        contact: { id: 'contact-b', email, name: 'Speaker B', createdAt: NOW },
        token: token('token-b', 'contact-b', 'b'.repeat(64)),
        message: message('message-b'),
        budget: testStartMailBudget('bb'),
      }),
    ])

    expect(await countRows(env.DB, 'contacts')).toBe(SEEDED_CONTACTS + 1)
    const contact = await env.DB.prepare('SELECT id FROM contacts WHERE email = ?')
      .bind(email)
      .first()
    expect(contact?.id).toBe('contact-a')
    const tokens = await env.DB.prepare('SELECT contact_id FROM submitter_tokens ORDER BY id').all<{
      contact_id: string
    }>()
    expect(tokens.results.map((row) => row.contact_id)).toEqual(['contact-a', 'contact-a'])
  })

  it('allows only one same-recipient reservation under concurrency', async () => {
    const unitOfWork = createSessionUnitOfWork(env.DB)
    const firstBudget = testStartMailBudget('same-a')
    const secondBudget = {
      ...firstBudget,
      operationId: 'budget-same-b',
    }

    const results = await Promise.all([
      unitOfWork.issueStart(startBatchInput('same-a', firstBudget, 'same@example.test')),
      unitOfWork.issueStart(startBatchInput('same-b', secondBudget, 'same@example.test')),
    ])

    expect(results.map((result) => result.outcome).sort()).toEqual(['issued', 'limited'])
    expect(await countRows(env.DB, 'mail_budget_events')).toBe(1)
    expect(await countRows(env.DB, 'submitter_tokens')).toBe(1)
    expect(await countRows(env.DB, 'captured_messages')).toBe(1)
  })

  it('counts recipient and environment budgets across UTC midnight in a rolling 24-hour window', async () => {
    const unitOfWork = createSessionUnitOfWork(env.DB)
    const now = '2026-05-20T00:30:00.000Z'
    const recipientBudget = testStartMailBudget('midnight-recipient', now)
    for (let index = 0; index < 5; index += 1) {
      await env.DB.prepare(
        `INSERT INTO mail_budget_events
           (operation_id, recipient_key, environment_key, created_at)
         VALUES (?, ?, ?, ?)`,
      )
        .bind(
          `recipient-before-midnight-${String(index)}`,
          recipientBudget.recipientKey,
          recipientBudget.environmentKey,
          `2026-05-19T01:0${String(index)}:00.000Z`,
        )
        .run()
    }
    expect(
      (await unitOfWork.issueStart(startBatchInput('midnight-recipient', recipientBudget))).outcome,
    ).toBe('limited')

    await env.DB.prepare('DELETE FROM mail_budget_events').run()
    const environmentBudget = testStartMailBudget('midnight-environment', now)
    await env.DB.prepare(
      `WITH RECURSIVE counter(value) AS (
         SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 250
       )
       INSERT INTO mail_budget_events (operation_id, recipient_key, environment_key, created_at)
       SELECT 'environment-before-midnight-' || value,
              'v1:start-recipient:' || printf('%064x', value), ?,
              '2026-05-19T01:00:00.000Z'
       FROM counter`,
    )
      .bind(environmentBudget.environmentKey)
      .run()
    expect(
      (await unitOfWork.issueStart(startBatchInput('midnight-environment', environmentBudget)))
        .outcome,
    ).toBe('limited')
  })

  it('does not let future-dated rows consume a current rolling budget', async () => {
    const unitOfWork = createSessionUnitOfWork(env.DB)
    const now = '2026-05-20T00:30:00.000Z'
    const budget = testStartMailBudget('future-bounded', now)
    for (let index = 0; index < 5; index += 1) {
      await env.DB.prepare(
        `INSERT INTO mail_budget_events
           (operation_id, recipient_key, environment_key, created_at)
         VALUES (?, ?, ?, ?)`,
      )
        .bind(
          `future-budget-${String(index)}`,
          budget.recipientKey,
          budget.environmentKey,
          `2026-05-20T01:0${String(index)}:00.000Z`,
        )
        .run()
    }

    expect((await unitOfWork.issueStart(startBatchInput('future-bounded', budget))).outcome).toBe(
      'issued',
    )
  })

  it('rolls a reservation and all downstream writes back when the batch fails', async () => {
    const unitOfWork = createSessionUnitOfWork(env.DB)
    const input = startBatchInput('rollback')
    await env.DB.prepare(
      `INSERT INTO captured_messages
         (id, event_id, to_email, subject, body, created_at, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        input.message.id,
        DEMO_CONF_2026_ID,
        'existing@example.test',
        'existing',
        'existing',
        NOW,
        'confirmation',
      )
      .run()

    await expect(unitOfWork.issueStart(input)).rejects.toThrow()
    expect(
      await env.DB.prepare('SELECT operation_id FROM mail_budget_events WHERE operation_id = ?')
        .bind(input.budget.operationId)
        .first(),
    ).toBeNull()
    expect(
      await env.DB.prepare('SELECT id FROM contacts WHERE email = ?')
        .bind(input.contact.email)
        .first(),
    ).toBeNull()
    expect(
      await env.DB.prepare('SELECT id FROM submitter_tokens WHERE id = ?')
        .bind(input.token.id)
        .first(),
    ).toBeNull()
  })

  it('a raw duplicate email insert is rejected by the UNIQUE constraint', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-1', 'speaker.a@example.test', 'A', NOW)
      .run()

    await expectRejects(
      env.DB,
      'INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)',
      'contact-2',
      'speaker.a@example.test',
      'B',
      NOW,
    )
  })

  it('rejects non-normalized emails at the database CHECK', async () => {
    await expectRejects(
      env.DB,
      'INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)',
      'contact-3',
      'Speaker.A@Example.TEST',
      'C',
      NOW,
    )
  })
})
