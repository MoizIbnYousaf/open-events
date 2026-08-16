import { describe, expect, it } from 'vitest'

import {
  productionBuildEnv,
  productionDeployArgs,
  validateBuiltProductionConfig,
} from '../../../scripts/deploy-production.mjs'

const D1 = '4983b9bb-cc1c-4ef0-83a6-154b19496909'
const R2 = 'open-events-production-files'

function valid() {
  return {
    name: 'open-events',
    assets: { binding: 'ASSETS', run_worker_first: true },
    routes: [
      { pattern: 'openevents.engineer', custom_domain: true },
      { pattern: 'www.openevents.engineer', custom_domain: true },
    ],
    vars: { DEPLOY_ENVIRONMENT: 'production', RESOURCE_D1_ID: D1, RESOURCE_R2_NAME: R2 },
    d1_databases: [{ binding: 'DB', database_id: D1 }],
    r2_buckets: [{ binding: 'FILES', bucket_name: R2 }],
    ratelimits: Array.from({ length: 7 }, (_, index) => ({
      name: `RATE_${index + 1}`,
      namespace_id: String(1101 + index),
    })),
  }
}

describe('production deploy artifact preflight', () => {
  it('stamps the exact release revision into Wrangler', () => {
    const revision = '44726e558b6bdc827ce4ae2f86caa8a4c7b3f1a5'
    expect(productionDeployArgs(revision, true)).toEqual([
      'deploy',
      '--env=',
      '--var',
      `BUILD_REVISION:${revision}`,
      '--message',
      'Release 44726e558b6b',
    ])
    expect(productionDeployArgs(revision, false)).toContain('--dry-run')
    expect(() => productionDeployArgs('stale', true)).toThrow('invalid production build revision')
  })

  it('pins the public Turnstile site key and cannot inherit acceptance routing', () => {
    expect(
      productionBuildEnv({
        CLOUDFLARE_ENV: 'acceptance',
        VITE_TURNSTILE_SITE_KEY: 'test-key',
      }),
    ).toMatchObject({ VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAERT1wYvk3NWLGeB' })
    expect(productionBuildEnv({ CLOUDFLARE_ENV: 'acceptance' })).not.toHaveProperty(
      'CLOUDFLARE_ENV',
    )
  })

  it('accepts only the production resource and route tuple', () => {
    expect(validateBuiltProductionConfig(valid())).toEqual({
      worker: 'open-events',
      d1: D1,
      r2: R2,
    })

    const acceptance = valid()
    acceptance.d1_databases[0]!.database_id = '8da9dc8c-7000-4052-b889-e7566514fe8f'
    expect(() => validateBuiltProductionConfig(acceptance)).toThrow()

    const missingRoute = valid()
    missingRoute.routes.pop()
    expect(() => validateBuiltProductionConfig(missingRoute)).toThrow()
  })
})
