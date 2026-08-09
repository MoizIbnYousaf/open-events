#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/** The single committed local D1 binding (same semantics as scripts/db-reset.mjs). */
export const BINDING = 'speakerops-m1-local'

const DB_RELATIVE_DIR = join('v3', 'd1', 'miniflare-D1DatabaseObject')
const EVENT_SLUG = 'demo-conf-2026'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'

function buildCounts() {
  return [
    {
      key: 'submissions',
      sql: `SELECT COUNT(*) FROM proposal_submissions WHERE form_version_id IN (SELECT id FROM cfp_form_versions WHERE form_id = '${FORM_ID}')`,
    },
    {
      key: 'contributors',
      sql: `SELECT COUNT(*) FROM submission_contributors WHERE submission_id IN (SELECT id FROM proposal_submissions WHERE form_version_id IN (SELECT id FROM cfp_form_versions WHERE form_id = '${FORM_ID}'))`,
    },
    {
      key: 'messages',
      sql: `SELECT COUNT(*) FROM captured_messages WHERE event_id = (SELECT id FROM events WHERE slug = '${EVENT_SLUG}') AND id IN (SELECT captured_message_id FROM confirmation_records WHERE submission_id IN (SELECT id FROM proposal_submissions WHERE form_version_id IN (SELECT id FROM cfp_form_versions WHERE form_id = '${FORM_ID}')))`,
    },
    {
      key: 'confirmations',
      sql: `SELECT COUNT(*) FROM confirmation_records WHERE submission_id IN (SELECT id FROM proposal_submissions WHERE form_version_id IN (SELECT id FROM cfp_form_versions WHERE form_id = '${FORM_ID}'))`,
    },
    {
      key: 'drafts',
      sql: `SELECT COUNT(*) FROM proposal_drafts WHERE form_version_id IN (SELECT id FROM cfp_form_versions WHERE form_id = '${FORM_ID}')`,
    },
  ]
}

/**
 * State-root precedence: explicit CLI persist-to first, then
 * WRANGLER_STATE_PATH, then the repo .wrangler/state default.
 */
export function resolveStateRoot({ persistTo, env, root }) {
  if (persistTo !== undefined) return persistTo
  if (env.WRANGLER_STATE_PATH !== undefined) return env.WRANGLER_STATE_PATH
  return join(root, '.wrangler', 'state')
}

/** Resolves the SINGLE non-metadata sqlite for the configured D1 binding. */
export function resolveDatabaseFile(stateRoot) {
  const dbDir = join(stateRoot, DB_RELATIVE_DIR)
  const candidates = readdirSync(dbDir).filter(
    (file) => file.endsWith('.sqlite') && file !== 'metadata.sqlite',
  )
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one D1 database file, found ${candidates.length} in ${dbDir}`)
  }
  return join(dbDir, candidates[0])
}

/** Bounded wrangler d1 execute --local --json parse seam (no shell parsing). */
export function runWranglerCount(spawn, binding, dbPath, sql) {
  const result = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      binding,
      '--local',
      '--json',
      '--persist-to',
      dbPath,
      '--command',
      sql,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(result.stderr || `wrangler d1 execute exited with status ${result.status}`)
  }
  const parsed = JSON.parse(result.stdout)
  const count = parsed[0]?.results?.[0]?.['COUNT(*)']
  if (typeof count !== 'number') {
    throw new Error('Unexpected wrangler count output')
  }
  return count
}

/** Five event/form-scoped persisted-row counts for the golden journey. */
export async function countGoldenRows({
  persistTo,
  env = {},
  root = process.cwd(),
  spawn = spawnSync,
}) {
  const stateRoot = resolveStateRoot({ persistTo, env, root })
  // Fail-closed validation: exactly one non-metadata sqlite must exist, but
  // wrangler's --persist-to consumes the state ROOT (it resolves the DB itself).
  resolveDatabaseFile(stateRoot)
  const counts = {}
  for (const { key, sql } of buildCounts()) {
    counts[key] = runWranglerCount(spawn, BINDING, stateRoot, sql)
  }
  return counts
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  const persistIndex = process.argv.indexOf('--persist-to')
  countGoldenRows({
    persistTo: persistIndex >= 0 ? process.argv[persistIndex + 1] : undefined,
    env: process.env,
  })
    .then((counts) => {
      process.stdout.write(`${JSON.stringify(counts)}\n`)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
