import type { D1Database, D1Result } from '@cloudflare/workers-types'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'

import migration0001Sql from '../../migrations/0001_create_events_table.sql?raw'
import migration0002Sql from '../../migrations/0002_create_m2_tables.sql?raw'
import migration0003Sql from '../../migrations/0003_add_m2b_lookup_indexes_integrity.sql?raw'
import migration0004Sql from '../../migrations/0004_global_unique_entity_ids.sql?raw'
import migration0005Sql from '../../migrations/0005_add_submitter_token_form.sql?raw'
import migration0006Sql from '../../migrations/0006_create_agenda_tables.sql?raw'
import migration0007Sql from '../../migrations/0007_create_speaker_task_tables.sql?raw'
import migration0008Sql from '../../migrations/0008_create_uploaded_files_table.sql?raw'
import migration0009Sql from '../../migrations/0009_add_captured_message_submission.sql?raw'
import migration0010Sql from '../../migrations/0010_create_evaluation_tables.sql?raw'
import migration0011Sql from '../../migrations/0011_add_form_tasks.sql?raw'
import migration0012Sql from '../../migrations/0012_add_message_kinds.sql?raw'
import migration0013Sql from '../../migrations/0013_add_contact_bio.sql?raw'
import migration0014Sql from '../../migrations/0014_widen_uploaded_file_kinds.sql?raw'
import migration0015Sql from '../../migrations/0015_fix_condition_rule_unique_grain.sql?raw'
import migration0018Sql from '../../migrations/0018_cascade_round_scores_to_criteria.sql?raw'
import migration0019Sql from '../../migrations/0019_add_assignment_recusal.sql?raw'
import migration0016Sql from '../../migrations/0016_create_submission_decisions.sql?raw'
import migration0017Sql from '../../migrations/0017_configurable_review_rounds.sql?raw'
import seedSql from '../../src/db/seed.sql?raw'
import type { CoSpeakerIntent, SubmitBatchInput } from '../../src/application'
import { DEMO_CONF_2026_FORM_ID, DEMO_CONF_2026_ID, DEMO_CONF_2026_VERSION_ID } from '../../src/db'
import type { ProposalSubmission } from '../../src/domain'
import { FIXED_NOW, OWNER_CONTACT_ID } from '../unit/helpers/fixtures'

/**
 * The committed migration set, in the order `wrangler d1 migrations apply`
 * runs it. Every migration belongs here: a baseline that skips numbers builds
 * a database no deployment ever has, so a test can pass against a schema that
 * cannot exist. Suites needing a migration also list it themselves — that is
 * harmless, because `applyD1Migrations` skips a name already recorded in
 * `d1_migrations`.
 */
export const MIGRATIONS: D1Migration[] = [
  { name: '0001_create_events_table.sql', queries: splitSqlStatements(migration0001Sql) },
  { name: '0002_create_m2_tables.sql', queries: splitSqlStatements(migration0002Sql) },
  {
    name: '0003_add_m2b_lookup_indexes_integrity.sql',
    queries: splitSqlStatements(migration0003Sql),
  },
  { name: '0004_global_unique_entity_ids.sql', queries: splitSqlStatements(migration0004Sql) },
  { name: '0005_add_submitter_token_form.sql', queries: splitSqlStatements(migration0005Sql) },
  { name: '0006_create_agenda_tables.sql', queries: splitSqlStatements(migration0006Sql) },
  { name: '0007_create_speaker_task_tables.sql', queries: splitSqlStatements(migration0007Sql) },
  { name: '0008_create_uploaded_files_table.sql', queries: splitSqlStatements(migration0008Sql) },
  {
    name: '0009_add_captured_message_submission.sql',
    queries: splitSqlStatements(migration0009Sql),
  },
  { name: '0010_create_evaluation_tables.sql', queries: splitSqlStatements(migration0010Sql) },
  { name: '0011_add_form_tasks.sql', queries: splitSqlStatements(migration0011Sql) },
  { name: '0012_add_message_kinds.sql', queries: splitSqlStatements(migration0012Sql) },
  { name: '0013_add_contact_bio.sql', queries: splitSqlStatements(migration0013Sql) },
  {
    name: '0014_widen_uploaded_file_kinds.sql',
    queries: splitSqlStatements(migration0014Sql),
  },
  {
    name: '0015_fix_condition_rule_unique_grain.sql',
    queries: splitSqlStatements(migration0015Sql),
  },
  {
    name: '0016_create_submission_decisions.sql',
    queries: splitSqlStatements(migration0016Sql),
  },
  {
    name: '0017_configurable_review_rounds.sql',
    queries: splitSqlStatements(migration0017Sql),
  },
  {
    name: '0018_cascade_round_scores_to_criteria.sql',
    queries: splitSqlStatements(migration0018Sql),
  },
  {
    name: '0019_add_assignment_recusal.sql',
    queries: splitSqlStatements(migration0019Sql),
  },
]

/**
 * The baseline truncated after `lastName`, for a suite that must stand on the
 * schema as it was BEFORE some migration — a backfill can only be observed
 * against rows that predate it. Throws on an unknown name so a rename cannot
 * silently produce an empty prefix that tests nothing.
 */
export function migrationsUpTo(lastName: string): D1Migration[] {
  const index = MIGRATIONS.findIndex((migration) => migration.name === lastName)
  if (index < 0) throw new Error(`No such migration in the baseline: '${lastName}'`)
  return MIGRATIONS.slice(0, index + 1)
}

/** Applies the baseline migrations to the pool D1 database. */
export async function applyMigrations(db: D1Database): Promise<void> {
  await applyD1Migrations(db, MIGRATIONS)
}

/**
 * Contacts created by the DemoConf 2026 seed: the standing review committee
 * (two reviewers), the organizer, and the two demo speakers the frozen scope
 * names. Row-count assertions offset by this instead of hard-coding a total,
 * so a later cast change stays a one-line edit.
 */
export const SEEDED_CONTACTS = 5

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
 * A complete set of answers to the SEEDED call for papers, as a speaker would
 * leave them.
 *
 * The published form asks for a real proposal — abstract, track, audience level
 * and key takeaway are required, and the participant step asks for a bio — and
 * choice answers hold the option VALUE a submitter picked, which is the
 * presentable label the programme's own format and track vocabulary uses. A
 * fixture answering `format: 'workshop'` is not merely stale: it is an answer no
 * option offers, and the same server-side validation that protects a real
 * submitter rejects it.
 *
 * Two variants, because the format is what drives the conditional question:
 * Workshop makes `workshop_details` visible AND required, Talk leaves it hidden
 * and unasked.
 */
export const SEEDED_TALK_ANSWERS = {
  format: 'Talk',
  track: 'Platform & Infra',
  abstract: 'How incremental builds cut a 40-minute CI pipeline down to minutes.',
  audience_level: 'Intermediate',
  key_takeaway: 'Which incremental-build investments actually pay off.',
  speaker_bio: 'Platform engineer working on build systems.',
} as const

export const SEEDED_WORKSHOP_ANSWERS = {
  ...SEEDED_TALK_ANSWERS,
  format: 'Workshop',
  workshop_details: 'Laptops with Node 20 and a checkout of the sample repository.',
} as const

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
    answers: opts.answers ?? SEEDED_WORKSHOP_ANSWERS,
    contentHash: 'a'.repeat(64),
    routing: { actionKind: 'assign_track', actionTarget: 'platform-infra' },
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
      kind: 'confirmation' as const,
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
