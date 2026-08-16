#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const WORKER_NAME = 'open-events'
const D1_ID = '4983b9bb-cc1c-4ef0-83a6-154b19496909'
const R2_NAME = 'open-events-production-files'
const TURNSTILE_SITE_KEY = '0x4AAAAAAERT1wYvk3NWLGeB'
const EXPECTED_RATE_LIMITS = new Set(['1101', '1102', '1103', '1104', '1105', '1106', '1107'])
const EXPECTED_ROUTES = new Set(['openevents.engineer', 'www.openevents.engineer'])

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

export function productionBuildEnv(environment = process.env) {
  const buildEnvironment = { ...environment }
  delete buildEnvironment.CLOUDFLARE_ENV
  buildEnvironment.VITE_TURNSTILE_SITE_KEY = TURNSTILE_SITE_KEY
  return buildEnvironment
}

export function validateBuiltProductionConfig(value) {
  const config = record(value)
  const vars = record(config?.vars)
  const assets = record(config?.assets)
  const d1 = Array.isArray(config?.d1_databases) ? config.d1_databases : []
  const r2 = Array.isArray(config?.r2_buckets) ? config.r2_buckets : []
  const routes = Array.isArray(config?.routes) ? config.routes : []
  const rateLimits = Array.isArray(config?.ratelimits) ? config.ratelimits : []
  const routePatterns = new Set(
    routes.flatMap((entry) => {
      const parsed = record(entry)
      return typeof parsed?.pattern === 'string' && parsed.custom_domain === true
        ? [parsed.pattern]
        : []
    }),
  )
  const namespaces = new Set(
    rateLimits.flatMap((entry) => {
      const parsed = record(entry)
      return typeof parsed?.namespace_id === 'string' ? [parsed.namespace_id] : []
    }),
  )
  if (
    config?.name !== WORKER_NAME ||
    assets?.binding !== 'ASSETS' ||
    assets?.run_worker_first !== true ||
    vars?.DEPLOY_ENVIRONMENT !== 'production' ||
    vars?.RESOURCE_D1_ID !== D1_ID ||
    vars?.RESOURCE_R2_NAME !== R2_NAME ||
    d1.length !== 1 ||
    record(d1[0])?.database_id !== D1_ID ||
    r2.length !== 1 ||
    record(r2[0])?.bucket_name !== R2_NAME ||
    routePatterns.size !== EXPECTED_ROUTES.size ||
    [...EXPECTED_ROUTES].some((route) => !routePatterns.has(route)) ||
    namespaces.size !== EXPECTED_RATE_LIMITS.size ||
    [...EXPECTED_RATE_LIMITS].some((namespace) => !namespaces.has(namespace))
  ) {
    throw new Error('built production configuration failed the release preflight')
  }
  return { worker: WORKER_NAME, d1: D1_ID, r2: R2_NAME }
}

function assertNoDevVars(root) {
  if (existsSync(resolve(root, '.dev.vars'))) {
    throw new Error('.dev.vars must be absent before a production release build')
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function releaseRevision(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  const revision = result.stdout?.trim() ?? ''
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('could not resolve the exact Git revision for the production release')
  }
  return revision
}

export function productionDeployArgs(revision, deploy) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('invalid production build revision')
  return [
    'deploy',
    '--env=',
    '--var',
    `BUILD_REVISION:${revision}`,
    '--message',
    `Release ${revision.slice(0, 12)}`,
    ...(deploy ? [] : ['--dry-run']),
  ]
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isMain) {
  const deploy = process.argv.includes('--deploy')
  if (process.argv.some((argument) => argument.startsWith('--') && argument !== '--deploy')) {
    throw new Error('unknown production deployment option')
  }
  const root = resolve(import.meta.dirname, '..')
  const revision = releaseRevision(root)
  assertNoDevVars(root)
  run('pnpm', ['clean'], { cwd: root })
  run('pnpm', ['build'], { cwd: root, env: productionBuildEnv() })
  const builtConfig = JSON.parse(
    readFileSync(resolve(root, 'dist', 'open_events', 'wrangler.json'), 'utf8'),
  )
  const receipt = validateBuiltProductionConfig(builtConfig)
  console.log(`production deploy preflight passed for ${receipt.worker}`)
  run('pnpm', ['exec', 'wrangler', ...productionDeployArgs(revision, deploy)], { cwd: root })
}
