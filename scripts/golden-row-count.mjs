#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/** The single committed local D1 binding (same semantics as scripts/db-reset.mjs). */
export const BINDING = 'open-events-production'

const DB_RELATIVE_DIR = join('v3', 'd1', 'miniflare-D1DatabaseObject')
const EVENT_SLUG = 'demo-conf-2026'
const FORM_ID = 'f0000000-0000-4000-8000-000000000001'

/** Submissions of the single committed golden form, as a reusable subquery. */
const GOLDEN_SUBMISSION_IDS = `SELECT id FROM proposal_submissions WHERE form_version_id IN (SELECT id FROM cfp_form_versions WHERE form_id = '${FORM_ID}')`

/** The single committed golden event id, as a reusable subquery. */
const GOLDEN_EVENT_ID = `SELECT id FROM events WHERE slug = '${EVENT_SLUG}'`

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
 * Lifecycle-tail counts: acceptance -> checklist -> completion -> headshot ->
 * acceptance message. Kept as their own count set (rather than extra keys on
 * buildCounts) so the frozen five-key golden contract and its assertions stay
 * exactly as committed; both sets share the same scoping keys, the same
 * fail-closed database validation, and the same bounded wrangler seam.
 */
export function buildLifecycleCounts() {
  return [
    {
      key: 'acceptances',
      sql: `SELECT COUNT(*) FROM submission_acceptances WHERE submission_id IN (${GOLDEN_SUBMISSION_IDS})`,
    },
    {
      key: 'speakerTasks',
      sql: `SELECT COUNT(*) FROM speaker_tasks WHERE submission_id IN (${GOLDEN_SUBMISSION_IDS})`,
    },
    {
      // Narrowed by status: "blockers dropped" must be distinguishable from
      // "the checklist was created".
      key: 'completedTasks',
      sql: `SELECT COUNT(*) FROM speaker_tasks WHERE status = 'completed' AND submission_id IN (${GOLDEN_SUBMISSION_IDS})`,
    },
    {
      key: 'headshots',
      sql: `SELECT COUNT(*) FROM uploaded_files WHERE kind = 'headshot' AND event_id = (${GOLDEN_EVENT_ID})`,
    },
    {
      // Only submission-linked captured rows: start-link deliveries and submit
      // confirmations keep a NULL submission_id (migration 0009).
      key: 'acceptanceMessages',
      sql: `SELECT COUNT(*) FROM captured_messages WHERE event_id = (${GOLDEN_EVENT_ID}) AND submission_id IN (${GOLDEN_SUBMISSION_IDS})`,
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
export function runWranglerCount(
  spawn,
  binding,
  dbPath,
  sql,
  remote = false,
  remoteEnv = undefined,
) {
  const locationArgs = remote
    ? [...(remoteEnv === undefined ? [] : ['--env', remoteEnv]), '--remote', '--json']
    : ['--local', '--json', '--persist-to', dbPath]
  const result = spawn(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', binding, ...locationArgs, '--command', sql],
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

/** Shared runner: fail-closed DB validation, then one bounded count per spec. */
async function countRows(
  specs,
  {
    persistTo,
    remote = false,
    remoteEnv,
    binding = BINDING,
    env = {},
    root = process.cwd(),
    spawn = spawnSync,
  },
) {
  const stateRoot = resolveStateRoot({ persistTo, env, root })
  // Fail-closed validation: exactly one non-metadata sqlite must exist, but
  // wrangler's --persist-to consumes the state ROOT (it resolves the DB itself).
  if (!remote) resolveDatabaseFile(stateRoot)
  const counts = {}
  for (const { key, sql } of specs) {
    counts[key] = runWranglerCount(spawn, binding, stateRoot, sql, remote, remoteEnv)
  }
  return counts
}

/** Five event/form-scoped persisted-row counts for the golden journey. */
export async function countGoldenRows(options) {
  return countRows(buildCounts(), options)
}

/** Five event/form-scoped persisted-row counts for the lifecycle tail. */
export async function countLifecycleRows(options) {
  return countRows(buildLifecycleCounts(), options)
}

/** CLI count-set selector: `--counts lifecycle`; anything else is the golden set. */
export function selectCounter(argv) {
  const index = argv.indexOf('--counts')
  return index >= 0 && argv[index + 1] === 'lifecycle' ? countLifecycleRows : countGoldenRows
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  const persistIndex = process.argv.indexOf('--persist-to')
  const bindingIndex = process.argv.indexOf('--binding')
  const environmentIndex = process.argv.indexOf('--env')
  selectCounter(process.argv)({
    persistTo: persistIndex >= 0 ? process.argv[persistIndex + 1] : undefined,
    remote: process.argv.includes('--remote'),
    binding: bindingIndex >= 0 ? process.argv[bindingIndex + 1] : BINDING,
    remoteEnv: environmentIndex >= 0 ? process.argv[environmentIndex + 1] : undefined,
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
