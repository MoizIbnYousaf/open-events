#!/usr/bin/env node
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { acceptanceTargetFromEnv } from './acceptance-target.mjs'
import { wranglerCommand } from './db-reset.mjs'

const EVENT_ID = 'a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d'
const root = resolve(import.meta.dirname, '..')

function runWrangler(args) {
  const { command, wranglerBin } = wranglerCommand(root)
  const result = spawnSync(command, [wranglerBin, ...args], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const target = acceptanceTargetFromEnv()
const resetSecret = process.env.ACCEPTANCE_RESET_SECRET ?? ''
if (resetSecret.length < 32) throw new Error('ACCEPTANCE_RESET_SECRET is missing')

const health = await globalThis.fetch(`${target.baseUrl}/api/health`)
if (!health.ok) throw new Error('acceptance health is unavailable')
const healthBody = await health.json()
if (
  healthBody.environment !== target.environment ||
  healthBody.build !== target.buildRevision ||
  healthBody.resources?.d1 !== target.d1Id ||
  healthBody.resources?.r2 !== target.r2Bucket
) {
  throw new Error('acceptance health tuple does not match the requested target')
}

const reset = await globalThis.fetch(`${target.baseUrl}/api/acceptance/reset`, {
  method: 'POST',
  headers: { authorization: `Bearer ${resetSecret}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    expectedEnvironment: target.environment,
    expectedBuildRevision: target.buildRevision,
    expectedEventId: EVENT_ID,
    expectedD1Id: target.d1Id,
    expectedR2Bucket: target.r2Bucket,
  }),
})
if (!reset.ok) throw new Error(`acceptance reset refused with status ${reset.status}`)

runWrangler([
  'd1',
  'execute',
  'open-events-acceptance',
  '--env',
  'acceptance',
  '--remote',
  '--file',
  'src/db/seed.sql',
])
if (process.argv.includes('--showcase')) {
  runWrangler([
    'd1',
    'execute',
    'open-events-acceptance',
    '--env',
    'acceptance',
    '--remote',
    '--file',
    'src/db/seed-programme.sql',
  ])
  runWrangler([
    'd1',
    'execute',
    'open-events-acceptance',
    '--env',
    'acceptance',
    '--remote',
    '--file',
    'src/db/seed-showcase.sql',
  ])
}
console.log('acceptance reset complete — isolated showcase event only')
