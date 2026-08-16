import { describe, expect, it } from 'vitest'

import * as acceptanceTarget from '../../../scripts/acceptance-target.mjs'

const {
  ACCEPTANCE_D1_ID,
  ACCEPTANCE_HOST,
  ACCEPTANCE_R2_NAME,
  acceptanceTargetFromEnv,
  validateAcceptanceTarget,
} = acceptanceTarget
const BUILD = '0123456789abcdef0123456789abcdef01234567'

function valid(overrides: Record<string, string | undefined> = {}) {
  return {
    baseUrl: `https://${ACCEPTANCE_HOST}`,
    environment: 'acceptance',
    buildRevision: BUILD,
    d1Id: ACCEPTANCE_D1_ID,
    r2Bucket: ACCEPTANCE_R2_NAME,
    ...overrides,
  }
}

describe('acceptance live-target preflight', () => {
  it('accepts only the provisioned acceptance tuple', () => {
    expect(validateAcceptanceTarget(valid())).toEqual({
      baseUrl: `https://${ACCEPTANCE_HOST}`,
      environment: 'acceptance',
      buildRevision: BUILD,
      d1Id: ACCEPTANCE_D1_ID,
      r2Bucket: ACCEPTANCE_R2_NAME,
    })
    expect(
      acceptanceTargetFromEnv({
        LIVE_BASE_URL: `https://${ACCEPTANCE_HOST}`,
        LIVE_EXPECTED_ENVIRONMENT: 'acceptance',
        LIVE_EXPECTED_BUILD: BUILD,
        LIVE_D1_ID: ACCEPTANCE_D1_ID,
        LIVE_R2_NAME: ACCEPTANCE_R2_NAME,
      }),
    ).toEqual(validateAcceptanceTarget(valid()))
  })

  it('refuses production and lookalike URLs', () => {
    for (const baseUrl of [
      'https://openevents.engineer',
      'https://www.openevents.engineer',
      'https://open-events.speakerops.workers.dev',
      'https://fake-acceptance.example.test',
      `http://${ACCEPTANCE_HOST}`,
      `https://${ACCEPTANCE_HOST}/path`,
    ]) {
      expect(() => validateAcceptanceTarget(valid({ baseUrl }))).toThrow()
    }
  })

  it('refuses missing labels, unknown resources, and malformed build identity', () => {
    expect(() => validateAcceptanceTarget(valid({ environment: undefined }))).toThrow()
    expect(() => validateAcceptanceTarget(valid({ buildRevision: 'not-a-revision' }))).toThrow()
    expect(() => validateAcceptanceTarget(valid({ buildRevision: BUILD.slice(0, 12) }))).toThrow()
    expect(() =>
      validateAcceptanceTarget(valid({ d1Id: '4983b9bb-cc1c-4ef0-83a6-154b19496909' })),
    ).toThrow()
    expect(() => validateAcceptanceTarget(valid({ d1Id: crypto.randomUUID() }))).toThrow()
    expect(() =>
      validateAcceptanceTarget(valid({ r2Bucket: 'open-events-production-files' })),
    ).toThrow()
    expect(() => validateAcceptanceTarget(valid({ r2Bucket: 'lookalike-acceptance' }))).toThrow()
  })
})
