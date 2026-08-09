import { beforeEach, describe, expect, it } from 'vitest'
import { env, reset } from 'cloudflare:test'

import type { D1Database } from '@cloudflare/workers-types'

import {
  SessionService,
  createSha256TokenHasher,
  createUuidTokenGenerator,
  publicCfpPath,
} from '../../src/application'
import {
  createContactRepository,
  createEventRepository,
  createFormRepository,
  createSessionRepository,
  createSessionUnitOfWork,
  createTokenRepository,
  DEMO_CONF_2026_FORM_ID,
  DEMO_CONF_2026_ID,
} from '../../src/db'
import { DbDecodeError, toSubmitterToken } from '../../src/db/mappers'
import type { SubmitterTokenRow } from '../../src/db/schema'
import { FIXED_NOW, NOW, OWNER_CONTACT_ID } from '../unit/helpers/fixtures'
import { applyMigrations, countRows, seedDemoConf } from './m2b-helpers'

const FUTURE = '2026-12-31T23:59:59.000Z'
const hasher = createSha256TokenHasher()
const generator = createUuidTokenGenerator()

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await seedDemoConf(env.DB)
  await env.DB.prepare('INSERT INTO contacts (id, email, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(OWNER_CONTACT_ID, 'speaker-a@example.test', 'Speaker A', NOW)
    .run()
})

function buildService(db: D1Database = env.DB) {
  return new SessionService(
    createTokenRepository(db),
    createSessionRepository(db),
    createContactRepository(db),
    createEventRepository(db),
    createFormRepository(db),
    hasher,
    generator,
    createSessionUnitOfWork(db),
    { now: () => FIXED_NOW },
  )
}

async function insertToken(
  opts: {
    readonly eventId?: string
    readonly formId?: string | null
    readonly expiresAt?: string
    readonly consumedAt?: string | null
  } = {},
): Promise<string> {
  const raw = crypto.randomUUID()
  const hash = await hasher.hash(raw)
  await env.DB.prepare(
    `INSERT INTO submitter_tokens (id, event_id, contact_id, form_id, token_hash,
                                     expires_at, consumed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `token-${crypto.randomUUID()}`,
      opts.eventId ?? DEMO_CONF_2026_ID,
      OWNER_CONTACT_ID,
      opts.formId === undefined ? DEMO_CONF_2026_FORM_ID : opts.formId,
      hash,
      opts.expiresAt ?? FUTURE,
      opts.consumedAt ?? null,
      NOW,
    )
    .run()
  return raw
}

async function expectDenialWithoutMutation(raw: string, expectedCode: string) {
  const hash = await hasher.hash(raw)
  const before = await env.DB.prepare(
    'SELECT consumed_at FROM submitter_tokens WHERE token_hash = ?',
  )
    .bind(hash)
    .first()
  const sessionsBefore = await countRows(env.DB, 'sessions')

  await expect(buildService().redeemSubmitterToken(raw, 60_000)).rejects.toMatchObject({
    code: expectedCode,
  })

  const after = await env.DB.prepare(
    'SELECT consumed_at FROM submitter_tokens WHERE token_hash = ?',
  )
    .bind(hash)
    .first()
  expect(after?.consumed_at).toBe(before?.consumed_at)
  expect(await countRows(env.DB, 'sessions')).toBe(sessionsBefore)
}

describe('migration 0005 and legacy token rows', () => {
  it('adds a nullable submitter_tokens.form_id from an empty database', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(submitter_tokens)').all<{
      name: string
      notnull: number
    }>()
    const formColumn = columns.results.find((column) => column.name === 'form_id')

    expect(formColumn).toBeDefined()
    expect(formColumn?.notnull).toBe(0)
  })

  it('preserves a legacy token row with null form_id and fails closed at the lookup', async () => {
    const raw = crypto.randomUUID()
    const hash = await hasher.hash(raw)
    await env.DB.prepare(
      `INSERT INTO submitter_tokens (id, event_id, contact_id, form_id, token_hash,
                                       expires_at, consumed_at, created_at)
         VALUES ('token-legacy', ?, ?, NULL, ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, OWNER_CONTACT_ID, hash, FUTURE, NOW)
      .run()

    const row = await env.DB.prepare('SELECT form_id FROM submitter_tokens WHERE id = ?')
      .bind('token-legacy')
      .first()
    expect(row?.form_id).toBeNull()
    expect(await createTokenRepository(env.DB).findByHash(hash)).toBeNull()
  })

  it('PRAGMA foreign_key_check reports no violations after 0005', async () => {
    await insertToken({})
    await env.DB.prepare(
      `INSERT INTO submitter_tokens (id, event_id, contact_id, form_id, token_hash,
                                       expires_at, consumed_at, created_at)
         VALUES ('token-legacy', ?, ?, NULL, ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, OWNER_CONTACT_ID, 'b'.repeat(64), FUTURE, NOW)
      .run()

    const violations = await env.DB.prepare('PRAGMA foreign_key_check').all()
    expect(violations.results).toEqual([])
  })

  it('keeps idx_cfp_forms_id as the unique parent index for the FK', async () => {
    const index = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
    )
      .bind('idx_cfp_forms_id')
      .first<{ sql: string }>()

    expect(index?.sql).toMatch(/^CREATE UNIQUE INDEX/)
  })
})

describe('token issuance with form_id', () => {
  it('the start flow persists form_id on the submitter token row', async () => {
    const service = buildService()
    let rawToken = ''

    const response = await service.startSubmitter(
      { email: 'speaker-a@example.test', eventSlug: 'demo-conf-2026', formSlug: 'cfp' },
      60_000,
      (token, path) => {
        rawToken = token
        return `http://localhost${path}?token=${token}`
      },
    )

    expect(response).toEqual({ status: 'accepted' })
    const hash = await hasher.hash(rawToken)
    const row = await env.DB.prepare('SELECT form_id FROM submitter_tokens WHERE token_hash = ?')
      .bind(hash)
      .first()
    expect(row?.form_id).toBe(DEMO_CONF_2026_FORM_ID)
    expect(await createTokenRepository(env.DB).findByHash(hash)).toMatchObject({
      formId: DEMO_CONF_2026_FORM_ID,
      eventId: DEMO_CONF_2026_ID,
    })
  })
})

describe('findByHash legacy-null boundary', () => {
  it('returns null (403 path) for a legacy null-form_id row and the row for a valid one', async () => {
    const legacyRaw = crypto.randomUUID()
    const legacyHash = await hasher.hash(legacyRaw)
    await env.DB.prepare(
      `INSERT INTO submitter_tokens (id, event_id, contact_id, form_id, token_hash,
                                       expires_at, consumed_at, created_at)
         VALUES ('token-legacy', ?, ?, NULL, ?, ?, NULL, ?)`,
    )
      .bind(DEMO_CONF_2026_ID, OWNER_CONTACT_ID, legacyHash, FUTURE, NOW)
      .run()
    const validRaw = await insertToken({})

    expect(await createTokenRepository(env.DB).findByHash(legacyHash)).toBeNull()
    expect(
      await createTokenRepository(env.DB).findByHash(await hasher.hash(validRaw)),
    ).toMatchObject({ formId: DEMO_CONF_2026_FORM_ID })
  })
})

describe('RedeemResult and trusted redirect derivation', () => {
  it('redeem returns a RedeemResult extending the session shape with redirectPath', async () => {
    const service = buildService()
    const raw = await insertToken({})

    const result = await service.redeemSubmitterToken(raw, 60_000)

    expect(result.token).toBeTruthy()
    expect(result.expiresAt).toBe('2026-05-20T09:01:00.000Z')
    expect(result.contactId).toBe(OWNER_CONTACT_ID)
    expect(result.eventId).toBe(DEMO_CONF_2026_ID)
    expect(result.redirectPath).toBe('/cfp/demo-conf-2026/cfp')
    expect(result.redirectPath).toBe(publicCfpPath('demo-conf-2026', 'cfp'))
  })

  it('derives the redirect path from persisted event and form slugs', async () => {
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
         VALUES ('event-custom', 'event-custom', 'Custom', 'UTC', 'draft', NULL, NULL)`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                                opens_at, closes_at, total_cap, per_identity_limit)
         VALUES ('event-custom', 'form-custom', 'form-custom', 'published', 'version-custom',
                 NULL, NULL, NULL, NULL)`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO cfp_form_versions (event_id, form_id, id, version, status,
                                        content_hash, published_at, updated_at)
         VALUES ('event-custom', 'form-custom', 'version-custom', 1, 'published',
                 ?, ?, ?)`,
    )
      .bind('a'.repeat(64), FIXED_NOW, FIXED_NOW)
      .run()
    const service = buildService()
    let rawToken = ''
    await service.startSubmitter(
      { email: 'speaker-a@example.test', eventSlug: 'event-custom', formSlug: 'form-custom' },
      60_000,
      (token, path) => {
        rawToken = token
        return path
      },
    )

    const result = await service.redeemSubmitterToken(rawToken, 60_000)

    expect(result.redirectPath).toBe('/cfp/event-custom/form-custom')
  })
})

describe('pre-consume failures leave zero token/session mutation', () => {
  it('rejects an unknown token with 403', async () => {
    await expectDenialWithoutMutation(crypto.randomUUID(), 'forbidden')
  })

  it('rejects an expired token with 403', async () => {
    const raw = await insertToken({ expiresAt: FIXED_NOW })
    await expectDenialWithoutMutation(raw, 'forbidden')
  })

  it('rejects an already-consumed token with 403', async () => {
    const raw = await insertToken({ consumedAt: NOW })
    await expectDenialWithoutMutation(raw, 'forbidden')
  })

  it('rejects a legacy null-form_id token with 403', async () => {
    const raw = await insertToken({ formId: null })
    await expectDenialWithoutMutation(raw, 'forbidden')
  })

  it('rejects a token whose form belongs to another event with 404', async () => {
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, status, starts_at, ends_at)
         VALUES ('event-b', 'event-b', 'Event B', 'UTC', 'draft', NULL, NULL)`,
    ).run()
    const raw = await insertToken({ eventId: 'event-b', formId: DEMO_CONF_2026_FORM_ID })
    await expectDenialWithoutMutation(raw, 'not_found')
  })

  it('rejects a token whose form is unpublished with 404', async () => {
    await env.DB.prepare(
      `INSERT INTO cfp_forms (event_id, id, slug, status, published_version_id,
                                opens_at, closes_at, total_cap, per_identity_limit)
         VALUES (?, 'form-unpub', 'form-unpub', 'draft', NULL, NULL, NULL, NULL, NULL)`,
    )
      .bind(DEMO_CONF_2026_ID)
      .run()
    const raw = await insertToken({ formId: 'form-unpub' })
    await expectDenialWithoutMutation(raw, 'not_found')
  })

  it('rejects a row that fails decode at the mapper boundary', () => {
    const row: SubmitterTokenRow = {
      id: 'token-decode',
      eventId: DEMO_CONF_2026_ID,
      contactId: OWNER_CONTACT_ID,
      formId: null,
      tokenHash: 'a'.repeat(64),
      expiresAt: FUTURE,
      consumedAt: null,
      createdAt: NOW,
    }

    expect(() => toSubmitterToken(row)).toThrow(
      new DbDecodeError('submitter token row is missing form_id'),
    )
  })
})

describe('replay after a successful redeem', () => {
  it('returns 403 on replay with a single session row and no further consume', async () => {
    const service = buildService()
    const raw = await insertToken({})

    const first = await service.redeemSubmitterToken(raw, 60_000)
    expect(first.redirectPath).toBe('/cfp/demo-conf-2026/cfp')

    await expect(service.redeemSubmitterToken(raw, 60_000)).rejects.toMatchObject({
      code: 'forbidden',
    })

    expect(await countRows(env.DB, 'sessions')).toBe(1)
    const row = await env.DB.prepare(
      'SELECT consumed_at FROM submitter_tokens WHERE token_hash = ?',
    )
      .bind(await hasher.hash(raw))
      .first()
    expect(row?.consumed_at).toBe(FIXED_NOW)
  })
})

describe('bounded statement counts', () => {
  function countingDb() {
    let prepares = 0
    const proxy = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (...args: unknown[]) => {
            prepares += 1
            return Reflect.apply(
              target.prepare as unknown as (...a: unknown[]) => unknown,
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

  it('issueStart executes at most 5 prepared statements', async () => {
    const { db, prepares } = countingDb()
    const unitOfWork = createSessionUnitOfWork(db)

    await unitOfWork.issueStart({
      contact: {
        id: 'contact-a',
        email: 'a@example.test',
        name: 'A',
        createdAt: NOW,
      },
      token: {
        id: 'token-a',
        contactId: 'contact-a',
        eventId: DEMO_CONF_2026_ID,
        formId: DEMO_CONF_2026_FORM_ID,
        tokenHash: 'a'.repeat(64),
        expiresAt: FUTURE,
        consumedAt: null,
        createdAt: NOW,
      },
      message: {
        id: 'message-a',
        eventId: DEMO_CONF_2026_ID,
        toEmail: 'a@example.test',
        subject: 's',
        body: 'b',
        createdAt: NOW,
      },
    })

    expect(prepares()).toBeLessThanOrEqual(5)
  })

  it('redeemSubmitterToken (adapter) executes at most 5 prepared statements', async () => {
    const raw = await insertToken({})
    const { db, prepares } = countingDb()
    const unitOfWork = createSessionUnitOfWork(db)
    const hash = await hasher.hash(raw)
    const token = await createTokenRepository(env.DB).findByHash(hash)
    expect(token).not.toBeNull()

    const result = await unitOfWork.redeemSubmitterToken({
      tokenId: token?.id ?? '',
      consumedAt: FIXED_NOW,
      session: {
        id: 'session-rr3',
        kind: 'submitter',
        contactId: OWNER_CONTACT_ID,
        eventId: DEMO_CONF_2026_ID,
        tokenHash: 'b'.repeat(64),
        expiresAt: FUTURE,
        consumedAt: null,
        createdAt: FIXED_NOW,
      },
    })

    expect(result).toEqual({ outcome: 'redeemed' })
    expect(prepares()).toBeLessThanOrEqual(5)
  })

  it('the full service redeem path executes at most 5 prepared statements', async () => {
    const raw = await insertToken({})
    const { db, prepares } = countingDb()
    const service = buildService(db)

    const result = await service.redeemSubmitterToken(raw, 60_000)

    expect(result.redirectPath).toBe('/cfp/demo-conf-2026/cfp')
    expect(prepares()).toBeLessThanOrEqual(5)
  })
})
