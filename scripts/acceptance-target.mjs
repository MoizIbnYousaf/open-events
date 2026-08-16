export const ACCEPTANCE_HOST = 'open-events-acceptance.speakerops.workers.dev'
export const ACCEPTANCE_D1_ID = '8da9dc8c-7000-4052-b889-e7566514fe8f'
export const ACCEPTANCE_R2_NAME = 'open-events-acceptance-files'
const PRODUCTION_D1_ID = '4983b9bb-cc1c-4ef0-83a6-154b19496909'
const PRODUCTION_R2_NAME = 'open-events-production-files'

/** Pure safety boundary shared by the reset script and live Playwright config. */
export function validateAcceptanceTarget(input) {
  if (input.environment !== 'acceptance') throw new Error('target environment is not acceptance')
  if (!/^[0-9a-f]{40}$/.test(input.buildRevision ?? '')) {
    throw new Error('expected build revision is missing or malformed')
  }
  if (input.d1Id !== ACCEPTANCE_D1_ID || input.d1Id === PRODUCTION_D1_ID) {
    throw new Error('acceptance D1 identifier is unknown or production')
  }
  if (
    typeof input.r2Bucket !== 'string' ||
    input.r2Bucket !== ACCEPTANCE_R2_NAME ||
    input.r2Bucket === PRODUCTION_R2_NAME
  ) {
    throw new Error('acceptance R2 bucket is unknown or production')
  }
  let url
  try {
    url = new globalThis.URL(input.baseUrl)
  } catch {
    throw new Error('acceptance base URL is invalid')
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.hostname !== ACCEPTANCE_HOST
  ) {
    throw new Error('acceptance base URL is unsafe')
  }
  return {
    baseUrl: url.origin,
    environment: 'acceptance',
    buildRevision: input.buildRevision,
    d1Id: input.d1Id,
    r2Bucket: input.r2Bucket,
  }
}

export function acceptanceTargetFromEnv(environment = process.env) {
  return validateAcceptanceTarget({
    baseUrl: environment.LIVE_BASE_URL,
    environment: environment.LIVE_EXPECTED_ENVIRONMENT,
    buildRevision: environment.LIVE_EXPECTED_BUILD,
    d1Id: environment.LIVE_D1_ID,
    r2Bucket: environment.LIVE_R2_NAME,
  })
}
