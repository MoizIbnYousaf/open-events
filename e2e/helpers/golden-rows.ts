import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Bounded helper: runs the committed scripts/golden-row-count.mjs via
 * execFileSync(process.execPath, [...]) — argv array, no shell, no inline SQL.
 */
export function countGoldenRows(): {
  readonly submissions: number
  readonly contributors: number
  readonly messages: number
  readonly confirmations: number
  readonly drafts: number
} {
  const repoRoot = resolve(import.meta.dirname, '..', '..')
  const stdout = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'golden-row-count.mjs'),
      '--persist-to',
      resolve(repoRoot, '.wrangler', 'state'),
    ],
    { encoding: 'utf8' },
  )
  return JSON.parse(stdout.trim()) as {
    readonly submissions: number
    readonly contributors: number
    readonly messages: number
    readonly confirmations: number
    readonly drafts: number
  }
}
