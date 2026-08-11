import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { createSessionUnitOfWork } from '../../src/db'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID } from '../../src/db'
import { NOW } from '../unit/helpers/fixtures'
import {
  SEEDED_CONTACTS,
  applyMigrations,
  countRows,
  expectRejects,
  seedDemoConf,
} from './m2b-helpers'

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
    tokenHash,
    expiresAt: FUTURE,
    consumedAt: null,
    createdAt: NOW,
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
      subject: 'Your SpeakerOps CFP link',
      body: 'Open your CFP session',
      createdAt: NOW,
      kind: 'confirmation' as const,
    })

    await Promise.all([
      unitOfWork.issueStart({
        contact: { id: 'contact-a', email, name: 'Speaker A', createdAt: NOW },
        token: token('token-a', 'contact-a', 'a'.repeat(64)),
        message: message('message-a'),
      }),
      unitOfWork.issueStart({
        contact: { id: 'contact-b', email, name: 'Speaker B', createdAt: NOW },
        token: token('token-b', 'contact-b', 'b'.repeat(64)),
        message: message('message-b'),
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
