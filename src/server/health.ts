import type { D1Database } from '@cloudflare/workers-types'

import type { ServerBindings, ServerContext } from './env'
import { getDatabaseBinding } from './env'

export type DeploymentEnvironment = 'local' | 'test' | 'acceptance' | 'production'

export interface DeploymentIdentity {
  readonly build: string
  readonly environment: DeploymentEnvironment
  readonly resources: {
    readonly d1: string
    readonly r2: string
  }
}

/** Safe health payload; reports only reviewed build/resource identity and D1 reachability. */
export interface HealthPayload extends DeploymentIdentity {
  readonly status: 'ok' | 'unavailable'
  readonly database: {
    readonly status: 'ok' | 'unavailable'
  }
}

const DEPLOY_ENVIRONMENTS = new Set<DeploymentEnvironment>([
  'local',
  'test',
  'acceptance',
  'production',
])
const RELEASE_REVISION = /^[0-9a-f]{40}$/
const LOCAL_REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const RESOURCE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function isDeploymentEnvironment(value: string | undefined): value is DeploymentEnvironment {
  return value !== undefined && DEPLOY_ENVIRONMENTS.has(value as DeploymentEnvironment)
}

/**
 * Resolves the exact tuple the release harness compares before any mutation.
 * Public environments require a full Git object id; a short/static label can
 * never make an acceptance or production deployment report healthy.
 */
export function deploymentIdentityFromBindings(env: ServerBindings): DeploymentIdentity | null {
  const environment = env.DEPLOY_ENVIRONMENT
  const build = env.BUILD_REVISION
  const d1 = env.RESOURCE_D1_ID
  const r2 = env.RESOURCE_R2_NAME
  if (
    !isDeploymentEnvironment(environment) ||
    build === undefined ||
    d1 === undefined ||
    r2 === undefined ||
    !RESOURCE_LABEL.test(d1) ||
    !RESOURCE_LABEL.test(r2)
  ) {
    return null
  }
  if (
    (environment === 'acceptance' || environment === 'production') &&
    !RELEASE_REVISION.test(build)
  ) {
    return null
  }
  if ((environment === 'local' || environment === 'test') && !LOCAL_REVISION.test(build)) {
    return null
  }
  return {
    build,
    environment,
    resources: { d1, r2 },
  }
}

/** Performs a real D1 read to prove the database binding is usable. */
export async function probeDatabase(db: D1Database): Promise<boolean> {
  try {
    const result = await db.prepare('SELECT 1').run()
    return result.success
  } catch {
    return false
  }
}

/** GET /api/health handler. */
export async function handleHealth(context: ServerContext): Promise<Response> {
  context.header('Cache-Control', 'no-store')
  const identity = deploymentIdentityFromBindings(context.env)
  if (identity === null) {
    return context.json(
      { error: { code: 'service_unavailable', message: 'Service unavailable' } },
      503,
    )
  }
  const db = getDatabaseBinding(context)
  const databaseStatus = db !== null && (await probeDatabase(db)) ? 'ok' : 'unavailable'
  const payload: HealthPayload = {
    status: databaseStatus === 'ok' ? 'ok' : 'unavailable',
    ...identity,
    database: { status: databaseStatus },
  }
  return context.json(payload, databaseStatus === 'ok' ? 200 : 503)
}
