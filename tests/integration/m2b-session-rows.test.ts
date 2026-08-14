import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import { createSessionRepository, createSessionUnitOfWork } from '../../src/db'
import { DbDecodeError, toSession } from '../../src/db/mappers'
import type { SessionRow } from '../../src/db/schema'
import type { DecodedSessionRow } from '../../src/domain'
import { validateSessionIdentity } from '../../src/domain'
import { DEMO_CONF_2026_ID } from '../../src/db'
import { NOW } from '../unit/helpers/fixtures'
import { applyMigrations, expectRejects, seedDemoConf } from './m2b-helpers'

const FUTURE = '2026-12-31T23:59:59.000Z'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
})

describe('discriminated session rows', () => {
  it('decodes an organizer row (NULL subject) with no contactId member', async () => {
    await env.DB.prepare(
      `INSERT INTO sessions (id, kind, contact_id, event_id, token_hash,
                               expires_at, consumed_at, created_at)
         VALUES ('session-org', 'organizer', NULL, NULL, ?, ?, NULL, ?)`,
    )
      .bind(HASH_A, FUTURE, NOW)
      .run()

    const session = await createSessionRepository(env.DB).findByHash(HASH_A)

    expect(session?.kind).toBe('organizer')
    expect(session).not.toHaveProperty('contactId')
    expect(session).not.toHaveProperty('eventId')
    const row: DecodedSessionRow = {
      id: session?.id ?? '',
      kind: 'organizer',
      contactId: null,
      eventId: undefined,
      tokenHash: HASH_A,
      expiresAt: FUTURE,
      consumedAt: null,
      createdAt: NOW,
    }
    expect(validateSessionIdentity(row)).toEqual([])
  })

  it('decodes a submitter row with contactId and eventId', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-sub', 'sub@example.test', 'Sub', NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO sessions (id, kind, contact_id, event_id, token_hash,
                               expires_at, consumed_at, created_at)
         VALUES ('session-sub', 'submitter', 'contact-sub', ?, ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, HASH_A, FUTURE, NOW)
      .run()

    const session = await createSessionRepository(env.DB).findByHash(HASH_A)

    expect(session?.kind).toBe('submitter')
    expect(session).toMatchObject({
      contactId: 'contact-sub',
      eventId: DEMO_CONF_2026_ID,
    })
  })

  it('rejects a submitter session row without a contact at the database', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO sessions (id, kind, contact_id, event_id, token_hash,
                             expires_at, consumed_at, created_at)
       VALUES ('session-bad', 'submitter', NULL, ?, ?, ?, NULL, ?)`,
      DEMO_CONF_2026_ID,
      HASH_A,
      FUTURE,
      NOW,
    )
  })

  it('rejects an organizer session row carrying an event at the database', async () => {
    await expectRejects(
      env.DB,
      `INSERT INTO sessions (id, kind, contact_id, event_id, token_hash,
                             expires_at, consumed_at, created_at)
       VALUES ('session-org-event', 'organizer', NULL, ?, ?, ?, NULL, ?)`,
      DEMO_CONF_2026_ID,
      HASH_A,
      FUTURE,
      NOW,
    )
  })

  it('rejects invalid decoded rows via the row validator and the mapper', () => {
    const submitterRow: SessionRow = {
      id: 'session-row-bad',
      kind: 'submitter',
      contactId: null,
      eventId: DEMO_CONF_2026_ID,
      tokenHash: HASH_A,
      expiresAt: FUTURE,
      consumedAt: null,
      createdAt: NOW,
    }
    const organizerRow: SessionRow = {
      id: 'session-row-org',
      kind: 'organizer',
      contactId: null,
      eventId: null,
      tokenHash: HASH_B,
      expiresAt: FUTURE,
      consumedAt: null,
      createdAt: NOW,
    }

    expect(() => toSession(submitterRow)).toThrow(DbDecodeError)
    expect(validateSessionIdentity(toDecodedRow(submitterRow)).map((i) => i.code)).toContain(
      'submitter_without_contact',
    )

    const organizerWithContact: SessionRow = { ...organizerRow, contactId: 'contact-sub' }
    expect(() => toSession(organizerWithContact)).toThrow(
      new DbDecodeError('An organizer session must not carry a contactId'),
    )
    expect(
      validateSessionIdentity(toDecodedRow(organizerWithContact)).map((i) => i.code),
    ).toContain('organizer_with_contact')

    const organizerWithEvent: SessionRow = { ...organizerRow, eventId: DEMO_CONF_2026_ID }
    expect(validateSessionIdentity(toDecodedRow(organizerWithEvent)).map((i) => i.code)).toEqual([
      'organizer_with_event',
    ])
    expect(() => toSession(organizerWithEvent)).toThrow(
      new DbDecodeError('An organizer session must not carry an eventId'),
    )
  })

  it('rejects a submitter session row with a contact but no event at the database', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-sub', 'sub@example.test', 'Sub', NOW)
      .run()

    await expectRejects(
      env.DB,
      `INSERT INTO sessions (id, kind, contact_id, event_id, token_hash,
                             expires_at, consumed_at, created_at)
       VALUES ('session-sub-no-event', 'submitter', 'contact-sub', NULL, ?, ?, NULL, ?)`,
      HASH_A,
      FUTURE,
      NOW,
    )
  })

  it('source wins on redeem: the persisted session derives identity from the token row', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-source', 'source@example.test', 'Source', NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO submitter_tokens (id, event_id, contact_id, token_hash,
                                       expires_at, consumed_at, created_at)
         VALUES ('token-source', ?, 'contact-source', ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, HASH_A, FUTURE, NOW)
      .run()
    const unitOfWork = createSessionUnitOfWork(env.DB)

    const result = await unitOfWork.redeemSubmitterToken({
      tokenId: 'token-source',
      consumedAt: NOW,
      session: {
        id: 'session-redeemed',
        kind: 'submitter',
        contactId: 'contact-other',
        eventId: 'event-other',
        tokenHash: HASH_B,
        expiresAt: FUTURE,
        consumedAt: null,
        createdAt: NOW,
      },
    })

    expect(result).toEqual({ outcome: 'redeemed' })
    const stored = await env.DB.prepare(
      'SELECT kind, contact_id, event_id FROM sessions WHERE id = ?',
    )
      .bind('session-redeemed')
      .first()
    expect(stored).toEqual({
      kind: 'submitter',
      contact_id: 'contact-source',
      event_id: DEMO_CONF_2026_ID,
    })
  })

  it('source wins on rotate: the persisted rotated session keeps the source identity', async () => {
    await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind('contact-source', 'source@example.test', 'Source', NOW)
      .run()
    await env.DB.prepare(
      `INSERT INTO sessions (id, kind, contact_id, event_id, token_hash,
                               expires_at, consumed_at, created_at)
         VALUES ('session-source', 'submitter', 'contact-source', ?, ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, HASH_A, FUTURE, NOW)
      .run()
    const unitOfWork = createSessionUnitOfWork(env.DB)

    const result = await unitOfWork.rotateSession({
      sessionId: 'session-source',
      consumedAt: NOW,
      rotated: {
        id: 'session-rotated',
        kind: 'submitter',
        contactId: 'contact-other',
        eventId: 'event-other',
        tokenHash: HASH_B,
        expiresAt: FUTURE,
        consumedAt: null,
        createdAt: NOW,
      },
    })

    expect(result).toEqual({ outcome: 'rotated' })
    const stored = await env.DB.prepare(
      'SELECT kind, contact_id, event_id FROM sessions WHERE id = ?',
    )
      .bind('session-rotated')
      .first()
    expect(stored).toEqual({
      kind: 'submitter',
      contact_id: 'contact-source',
      event_id: DEMO_CONF_2026_ID,
    })
  })
})

function toDecodedRow(row: SessionRow): DecodedSessionRow {
  return {
    id: row.id,
    kind: row.kind,
    contactId: row.contactId,
    eventId: row.eventId ?? undefined,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  }
}
