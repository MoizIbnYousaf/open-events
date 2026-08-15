import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export interface GoldenRowCounts {
  readonly submissions: number
  readonly contributors: number
  readonly messages: number
  readonly confirmations: number
  readonly drafts: number
}

export interface LifecycleRowCounts {
  readonly acceptances: number
  readonly speakerTasks: number
  readonly completedTasks: number
  readonly headshots: number
  readonly acceptanceMessages: number
}

/**
 * Bounded helper: runs the committed scripts/golden-row-count.mjs via
 * execFileSync(process.execPath, [...]) — argv array, no shell, no inline SQL.
 */
function runRowCount(extraArgs: readonly string[]): unknown {
  const repoRoot = resolve(import.meta.dirname, '..', '..')
  const args = [
    resolve(repoRoot, 'scripts', 'golden-row-count.mjs'),
    ...(process.env.LIVE_PRODUCTION === 'true'
      ? ['--remote']
      : ['--persist-to', resolve(repoRoot, '.wrangler', 'state')]),
    ...extraArgs,
  ]
  let lastError: unknown
  const attempts = process.env.LIVE_PRODUCTION === 'true' ? 1 : 4
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const stdout = execFileSync(process.execPath, args, { encoding: 'utf8' })
      return JSON.parse(stdout.trim())
    } catch (error) {
      lastError = error
      if (attempt + 1 < attempts) {
        // The running local Worker and Wrangler briefly contend for the same
        // SQLite file immediately after agenda publication. Retry the bounded
        // evidence read; never retry a remote production read.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
      }
    }
  }
  throw lastError
}

/** Reads the production/local captured-mail outbox without exposing it through an HTTP route. */
export function capturedMessages(email: string): readonly { readonly body: string }[] {
  if (process.env.LIVE_PRODUCTION !== 'true') {
    throw new Error('capturedMessages is reserved for LIVE_PRODUCTION runs')
  }
  const repoRoot = resolve(import.meta.dirname, '..', '..')
  const escapedEmail = email.replaceAll("'", "''")
  const stdout = execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      'open-events-production',
      '--remote',
      '--json',
      '--command',
      `SELECT body FROM captured_messages WHERE to_email = '${escapedEmail}' ORDER BY created_at`,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  const parsed = JSON.parse(stdout) as Array<{ results?: Array<{ body?: unknown }> }>
  return (parsed[0]?.results ?? []).flatMap((row) =>
    typeof row.body === 'string' ? [{ body: row.body }] : [],
  )
}

/** The frozen five golden-journey counts. */
export function countGoldenRows(): GoldenRowCounts {
  return runRowCount([]) as GoldenRowCounts
}

/** The five lifecycle-tail counts, from the same committed script. */
export function countLifecycleRows(): LifecycleRowCounts {
  return runRowCount(['--counts', 'lifecycle']) as LifecycleRowCounts
}
