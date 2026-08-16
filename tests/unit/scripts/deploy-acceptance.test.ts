import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import {
  acceptanceBuildEnv,
  acceptanceDeployArgs,
  assertNoBuiltDevVars,
  assertNoLocalDevVars,
  validateBuiltAcceptanceConfig,
} from '../../../scripts/deploy-acceptance.mjs'

const D1 = '8da9dc8c-7000-4052-b889-e7566514fe8f'
const R2 = 'open-events-acceptance-files'

function valid() {
  return {
    name: 'open-events-acceptance',
    targetEnvironment: 'acceptance',
    workers_dev: true,
    routes: [],
    assets: { directory: '../client', binding: 'ASSETS', run_worker_first: true },
    vars: {
      DEPLOY_ENVIRONMENT: 'acceptance',
      RESOURCE_D1_ID: D1,
      RESOURCE_R2_NAME: R2,
    },
    d1_databases: [{ binding: 'DB', database_id: D1 }],
    r2_buckets: [{ binding: 'FILES', bucket_name: R2 }],
    ratelimits: Array.from({ length: 7 }, (_, index) => ({
      name: `RATE_${index + 1}`,
      namespace_id: String(2101 + index),
    })),
  }
}

describe('acceptance deploy artifact preflight', () => {
  it('stamps the exact release revision into Wrangler', () => {
    const revision = '44726e558b6bdc827ce4ae2f86caa8a4c7b3f1a5'
    expect(acceptanceDeployArgs(revision, true)).toEqual([
      'deploy',
      '--env',
      'acceptance',
      '--var',
      `BUILD_REVISION:${revision}`,
      '--message',
      'Release 44726e558b6b',
    ])
    expect(acceptanceDeployArgs(revision, false)).toContain('--dry-run')
    expect(() => acceptanceDeployArgs('stale', true)).toThrow('invalid acceptance build revision')
  })

  it('pins the acceptance build to Cloudflare test Turnstile without inheriting production', () => {
    expect(
      acceptanceBuildEnv({
        CLOUDFLARE_ENV: 'production',
        VITE_TURNSTILE_SITE_KEY: 'production-site-key',
      }),
    ).toMatchObject({
      CLOUDFLARE_ENV: 'acceptance',
      VITE_CLERK_PUBLISHABLE_KEY: '',
      VITE_CLERK_ORGANIZER_POLICY_CONFIGURED: 'false',
      VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    })
  })

  it('refuses local or built Wrangler secret files', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'open-events-acceptance-deploy-'))
    try {
      expect(() => assertNoLocalDevVars(root)).not.toThrow()
      writeFileSync(resolve(root, '.dev.vars'), 'SECRET=value')
      expect(() => assertNoLocalDevVars(root)).toThrow('.dev.vars must be absent')
      rmSync(resolve(root, '.dev.vars'))

      mkdirSync(resolve(root, 'dist', 'open_events'), { recursive: true })
      writeFileSync(resolve(root, 'dist', 'open_events', '.dev.vars'), 'SECRET=value')
      expect(() => assertNoBuiltDevVars(root)).toThrow('forbidden .dev.vars')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts the exact isolated artifact', () => {
    expect(validateBuiltAcceptanceConfig(valid())).toEqual({
      worker: 'open-events-acceptance',
      d1: D1,
      r2: R2,
      rateLimitNamespaces: ['2101', '2102', '2103', '2104', '2105', '2106', '2107'],
    })
  })

  it('refuses production resources, custom routes, and missing namespaces', () => {
    const production = valid()
    production.d1_databases[0]!.database_id = '4983b9bb-cc1c-4ef0-83a6-154b19496909'
    expect(() => validateBuiltAcceptanceConfig(production)).toThrow()

    const routed = valid()
    routed.routes = [{ pattern: 'openevents.engineer' }] as never
    expect(() => validateBuiltAcceptanceConfig(routed)).toThrow()

    const bypassedAssets = valid()
    bypassedAssets.assets.run_worker_first = false
    expect(() => validateBuiltAcceptanceConfig(bypassedAssets)).toThrow()

    const incomplete = valid()
    incomplete.ratelimits.pop()
    expect(() => validateBuiltAcceptanceConfig(incomplete)).toThrow()
  })
})
