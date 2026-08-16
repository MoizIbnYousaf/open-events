import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import {
  decryptMailPayload,
  fingerprintMailRecipient,
} from '../../src/application/security/mail-payload'

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
  const remoteAcceptance = process.env.LIVE_ALLOW_MUTATION === 'acceptance'
  const args = [
    resolve(repoRoot, 'scripts', 'golden-row-count.mjs'),
    ...(remoteAcceptance
      ? ['--remote', '--binding', 'open-events-acceptance', '--env', 'acceptance']
      : ['--persist-to', resolve(repoRoot, '.wrangler', 'state')]),
    ...extraArgs,
  ]
  let lastError: unknown
  const attempts = remoteAcceptance ? 1 : 4
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const stdout = execFileSync(process.execPath, args, { encoding: 'utf8' })
      return JSON.parse(stdout.trim())
    } catch (error) {
      lastError = error
      if (attempt + 1 < attempts) {
        // The running local Worker and Wrangler briefly contend for the same
        // SQLite file immediately after agenda publication. Retry the bounded
        // evidence read; never retry a remote acceptance read.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
      }
    }
  }
  throw lastError
}

/** Reads the acceptance captured-mail outbox without exposing it through an HTTP route. */
export async function capturedMessages(
  email: string,
): Promise<readonly { readonly body: string }[]> {
  if (process.env.LIVE_ALLOW_MUTATION !== 'acceptance') {
    throw new Error('capturedMessages is reserved for guarded acceptance runs')
  }
  const keyMaterialBase64 = process.env.LIVE_EMAIL_PAYLOAD_KEY_V1
  if (keyMaterialBase64 === undefined) {
    throw new Error('LIVE_EMAIL_PAYLOAD_KEY_V1 is required for an acceptance lifecycle run')
  }
  const payloadKey = { keyVersion: 'v1', keyMaterialBase64 }
  const fingerprint = await fingerprintMailRecipient(email, payloadKey)
  const repoRoot = resolve(import.meta.dirname, '..', '..')
  const escapedFingerprint = fingerprint.replaceAll("'", "''")
  const stdout = execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      'open-events-acceptance',
      '--env',
      'acceptance',
      '--remote',
      '--json',
      '--command',
      `SELECT j.id AS job_id, j.captured_message_id, j.mode, j.key_version,
              j.nonce, j.ciphertext, j.payload_expires_at
       FROM email_delivery_jobs j
       WHERE j.recipient_fingerprint = '${escapedFingerprint}'
       ORDER BY j.created_at`,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  const parsed = JSON.parse(stdout) as Array<{
    results?: Array<{
      job_id: string
      captured_message_id: string
      mode: 'capture' | 'resend-test' | 'resend-live'
      key_version: string
      nonce: string
      ciphertext: string
      payload_expires_at: string
    }>
  }>
  return Promise.all(
    (parsed[0]?.results ?? []).map(async (row) => {
      const payload = await decryptMailPayload(
        {
          jobId: row.job_id,
          messageId: row.captured_message_id,
          mode: row.mode,
          recipientFingerprint: fingerprint,
          recipientLabel: 'acceptance-test-recipient',
          auditBody: 'acceptance-test-audit',
          keyVersion: row.key_version,
          nonce: row.nonce,
          ciphertext: row.ciphertext,
          expiresAt: row.payload_expires_at,
        },
        payloadKey,
      )
      return { body: payload.body }
    }),
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
