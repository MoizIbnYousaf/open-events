#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

import { ACCEPTANCE_D1_ID, ACCEPTANCE_R2_NAME } from './acceptance-target.mjs'
import { restoreDevVars } from './golden-dev-vars.mjs'

const WORKER_NAME = 'open-events-acceptance'
const EXPECTED_RATE_LIMITS = new Set(['2101', '2102', '2103', '2104', '2105', '2106', '2107'])
const ACCEPTANCE_TURNSTILE_SITE_KEY = '1x00000000000000000000AA'

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

/** Fail-closed inspection of Vite's redirected Wrangler build artifact. */
export function validateBuiltAcceptanceConfig(value) {
  const config = record(value)
  const vars = record(config?.vars)
  const d1 = Array.isArray(config?.d1_databases) ? config.d1_databases : []
  const r2 = Array.isArray(config?.r2_buckets) ? config.r2_buckets : []
  const rateLimits = Array.isArray(config?.ratelimits) ? config.ratelimits : []
  const namespaces = new Set(
    rateLimits.flatMap((entry) => {
      const parsed = record(entry)
      return typeof parsed?.namespace_id === 'string' ? [parsed.namespace_id] : []
    }),
  )
  if (
    config?.name !== WORKER_NAME ||
    config?.targetEnvironment !== 'acceptance' ||
    config?.workers_dev !== true ||
    !Array.isArray(config?.routes) ||
    config.routes.length !== 0 ||
    record(config?.assets)?.directory === undefined ||
    record(config?.assets)?.binding !== 'ASSETS' ||
    record(config?.assets)?.run_worker_first !== true ||
    vars?.DEPLOY_ENVIRONMENT !== 'acceptance' ||
    vars?.RESOURCE_D1_ID !== ACCEPTANCE_D1_ID ||
    vars?.RESOURCE_R2_NAME !== ACCEPTANCE_R2_NAME ||
    d1.length !== 1 ||
    record(d1[0])?.database_id !== ACCEPTANCE_D1_ID ||
    r2.length !== 1 ||
    record(r2[0])?.bucket_name !== ACCEPTANCE_R2_NAME ||
    namespaces.size !== EXPECTED_RATE_LIMITS.size ||
    [...EXPECTED_RATE_LIMITS].some((namespace) => !namespaces.has(namespace))
  ) {
    throw new Error('built acceptance configuration failed the isolated-resource preflight')
  }
  return {
    worker: WORKER_NAME,
    d1: ACCEPTANCE_D1_ID,
    r2: ACCEPTANCE_R2_NAME,
    rateLimitNamespaces: [...namespaces].sort(),
  }
}

/** Acceptance uses Cloudflare's documented always-pass public test widget. */
export function acceptanceBuildEnv(environment = process.env) {
  return {
    ...environment,
    CLOUDFLARE_ENV: 'acceptance',
    VITE_CLERK_PUBLISHABLE_KEY: '',
    VITE_CLERK_ORGANIZER_POLICY_CONFIGURED: 'false',
    VITE_TURNSTILE_SITE_KEY: ACCEPTANCE_TURNSTILE_SITE_KEY,
  }
}

/** Release builds never read or upload developer-owned Wrangler secret files. */
export function assertNoLocalDevVars(root) {
  for (const name of ['.dev.vars', '.dev.vars.acceptance']) {
    if (existsSync(resolve(root, name))) {
      throw new Error(`${name} must be absent before an acceptance release build`)
    }
  }
}

export function assertNoBuiltDevVars(root) {
  if (existsSync(resolve(root, 'dist', 'open_events', '.dev.vars'))) {
    throw new Error('acceptance build contains a forbidden .dev.vars file')
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  const deploy = process.argv.includes('--deploy')
  if (process.argv.some((argument) => argument.startsWith('--') && argument !== '--deploy')) {
    throw new Error('unknown acceptance deployment option')
  }
  const root = resolve(import.meta.dirname, '..')
  // A Playwright hard stop can leave the wrapper-owned file behind; recover
  // its snapshot first. Any genuine developer file then blocks the release.
  restoreDevVars(root)
  assertNoLocalDevVars(root)
  run('pnpm', ['clean'], { cwd: root })
  run('pnpm', ['build'], {
    cwd: root,
    env: acceptanceBuildEnv(),
  })
  assertNoBuiltDevVars(root)
  const builtConfig = JSON.parse(
    readFileSync(resolve(root, 'dist', 'open_events', 'wrangler.json'), 'utf8'),
  )
  const receipt = validateBuiltAcceptanceConfig(builtConfig)
  console.log(`acceptance deploy preflight passed for ${receipt.worker}`)
  run(
    'pnpm',
    ['exec', 'wrangler', 'deploy', '--env', 'acceptance', ...(deploy ? [] : ['--dry-run'])],
    { cwd: root },
  )
}
