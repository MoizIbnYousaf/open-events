import { describe, expect, it } from 'vitest'

import { deploymentIdentityFromBindings } from '../../../src/server/health'

const DB = {} as D1Database
const FILES = {} as R2Bucket

describe('deployment health identity', () => {
  it('requires full source identity for acceptance and production', () => {
    expect(
      deploymentIdentityFromBindings({
        DB,
        FILES,
        DEPLOY_ENVIRONMENT: 'acceptance',
        BUILD_REVISION: '0123456789abcdef0123456789abcdef01234567',
        RESOURCE_D1_ID: '8da9dc8c-7000-4052-b889-e7566514fe8f',
        RESOURCE_R2_NAME: 'open-events-acceptance-files',
      } as never),
    ).toEqual({
      build: '0123456789abcdef0123456789abcdef01234567',
      environment: 'acceptance',
      resources: {
        d1: '8da9dc8c-7000-4052-b889-e7566514fe8f',
        r2: 'open-events-acceptance-files',
      },
    })
    expect(
      deploymentIdentityFromBindings({
        DB,
        FILES,
        DEPLOY_ENVIRONMENT: 'production',
        BUILD_REVISION: 'short-sha',
        RESOURCE_D1_ID: 'production-d1',
        RESOURCE_R2_NAME: 'production-r2',
      } as never),
    ).toBeNull()
  })

  it('fails closed on missing, unknown, or malformed identity fields', () => {
    expect(deploymentIdentityFromBindings({ DB, FILES } as never)).toBeNull()
    expect(
      deploymentIdentityFromBindings({
        DB,
        FILES,
        DEPLOY_ENVIRONMENT: 'staging',
        BUILD_REVISION: 'test',
        RESOURCE_D1_ID: 'test-d1',
        RESOURCE_R2_NAME: 'test-r2',
      } as never),
    ).toBeNull()
    expect(
      deploymentIdentityFromBindings({
        DB,
        FILES,
        DEPLOY_ENVIRONMENT: 'local',
        BUILD_REVISION: 'local build',
        RESOURCE_D1_ID: 'test-d1',
        RESOURCE_R2_NAME: 'test-r2',
      } as never),
    ).toBeNull()
  })
})
