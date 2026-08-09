import type { D1Database, D1Result } from '@cloudflare/workers-types'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'

import migration0001Sql from '../../migrations/0001_create_events_table.sql?raw'
import migration0002Sql from '../../migrations/0002_create_m2_tables.sql?raw'
import migration0003Sql from '../../migrations/0003_add_m2b_lookup_indexes_integrity.sql?raw'
import migration0004Sql from '../../migrations/0004_global_unique_entity_ids.sql?raw'
import migration0005Sql from '../../migrations/0005_add_submitter_token_form.sql?raw'
import seedSql from '../../src/db/seed.sql?raw'
import type { CoSpeakerIntent, SubmitBatchInput } from '../../src/application'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import type { ProposalSubmission } from '../../src/domain'
import { FIXED_NOW, OWNER_CONTACT_ID } from '../unit/helpers/fixtures'

export const MIGRATIONS: D1Migration[] = [
  { name: '0001_create_events_table.sql', queries: splitSqlStatements(migration0001Sql) },
  { name: '0002_create_m2_tables.sql', queries: splitSqlStatements(migration0002Sql) },
  {
    name: '0003_add_m2b_lookup_indexes_integrity.sql',
    queries: splitSqlStatements(migration0003Sql),
  },
  { name: '0004_global_unique_entity_ids.sql', queries: splitSqlStatements(migration0004Sql) },
  { name: '0005_add_submitter_token_form.sql', queries: splitSqlStatements(migration0005Sql) },
]

/** Applies both real migrations to the pool D1 database. */
export async function applyMigrations(db: D1Database): Promise<void> {
  await applyD1Migrations(db, MIGRATIONS)
}

/** Applies the real deterministic DemoConf 2026 seed script. */
export async function seedDemoConf(db: D1Database): Promise<void> {
  for (const statement of splitSqlStatements(seedSql)) {
    await db.prepare(statement).run()
  }
}

/**
 * Splits a SQL script into single statements, respecting SQLite `BEGIN...END`
 * blocks (the immutability triggers in migration 0002 contain inner
 * statements) and quoted string literals.
 */
export function splitSqlStatements(sql: string): string[] {
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let beginDepth = 0
  let index = 0
  while (index < stripped.length) {
    const char = stripped[index] ?? ''
    if (inSingleQuote) {
      current += char
      if (char === "'") {
        if (stripped[index + 1] === "'") {
          current += "'"
          index += 2
          continue
        }
        inSingleQuote = false
      }
      index += 1
      continue
    }
    if (inDoubleQuote) {
      current += char
      if (char === '"') inDoubleQuote = false
      index += 1
      continue
    }
    if (char === "'") {
      inSingleQuote = true
      current += char
      index += 1
      continue
    }
    if (char === '"') {
      inDoubleQuote = true
      current += char
      index += 1
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index
      while (end < stripped.length && /[A-Za-z_]/.test(stripped[end] ?? '')) end += 1
      const word = stripped.slice(index, end).toUpperCase()
      if (word === 'BEGIN') beginDepth += 1
      else if (word === 'END') beginDepth = Math.max(0, beginDepth - 1)
      current += stripped.slice(index, end)
      index = end
      continue
    }
    if (char === ';' && beginDepth === 0) {
      const statement = current.trim()
      if (statement.length > 0) statements.push(statement)
      current = ''
      index += 1
      continue
    }
    current += char
    index += 1
  }
  const tail = current.trim()
  if (tail.length > 0) statements.push(tail)
  return statements
}

/** Counts rows in a table (single-column `count` result). */
export async function countRows(db: D1Database, table: string): Promise<number> {
  const result = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()
  return result?.n ?? 0
}

/** Runs a statement and asserts it rejects (constraint/trigger/FK denial). */
export async function expectRejects(
  db: D1Database,
  sql: string,
  ...binds: unknown[]
): Promise<void> {
  await expectPromiseRejects(
    db
      .prepare(sql)
      .bind(...binds)
      .run(),
  )
}

/**
 * Builds a valid `SubmitBatchInput` against the seeded DemoConf 2026 published
 * form/version. Override the seeded ids for gate tests.
 */
export function buildSubmitBatch(
  opts: {
    readonly eventId?: string
    readonly formId?: string
    readonly formVersionId?: string
    readonly originDraftId?: string
    readonly ownerContactId?: string
    readonly submittedAt?: string
    readonly coSpeakers?: readonly CoSpeakerIntent[]
    readonly submissionId?: string
    readonly messageCreatedAt?: string
    readonly title?: string
    readonly answers?: ProposalSubmission['answers']
  } = {},
): SubmitBatchInput {
  const eventId = opts.eventId ?? DEMO_CONF_2026_ID
  const formId = opts.formId ?? DEMO_CONF_2026_FORM_ID
  const formVersionId = opts.formVersionId ?? DEMO_CONF_2026_VERSION_ID
  const originDraftId = opts.originDraftId ?? 'draft-origin-1'
  const ownerContactId = opts.ownerContactId ?? OWNER_CONTACT_ID
  const submittedAt = opts.submittedAt ?? FIXED_NOW
  const submissionId = opts.submissionId ?? 'submission-1'
  const messageId = `message-${submissionId}`
  const submission: ProposalSubmission = {
    id: submissionId,
    eventId,
    ownerContactId,
    formVersionId,
    originDraftId,
    status: 'pending',
    title: opts.title ?? 'Workshop proposal',
    answers: opts.answers ?? { format: 'workshop', title: 'Workshop proposal' },
    contentHash: 'a'.repeat(64),
    routing: { actionKind: 'assign_track', actionTarget: 'workshop' },
    createdAt: submittedAt,
    submittedAt,
  }
  return {
    eventId,
    formId,
    originDraftId,
    ownerContactId,
    submittedAt,
    submission,
    coSpeakers: opts.coSpeakers ?? [],
    confirmation: {
      id: `confirmation-${submissionId}`,
      eventId,
      submissionId,
      capturedMessageId: messageId,
      createdAt: submittedAt,
    },
    message: {
      id: messageId,
      eventId,
      toEmail: 'speaker-a@example.test',
      subject: 'Your submission was received',
      body: 'ok',
      createdAt: opts.messageCreatedAt ?? submittedAt,
    },
  }
}

async function expectPromiseRejects(promise: Promise<D1Result>): Promise<void> {
  let rejected = false
  try {
    await promise
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('expected the D1 statement to reject')
}
