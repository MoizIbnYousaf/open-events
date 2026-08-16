export interface AcceptanceTarget {
  readonly baseUrl: string
  readonly environment: 'acceptance'
  readonly buildRevision: string
  readonly d1Id: string
  readonly r2Bucket: string
}
export const ACCEPTANCE_HOST: string
export const ACCEPTANCE_D1_ID: string
export const ACCEPTANCE_R2_NAME: string
export function validateAcceptanceTarget(
  input: Record<string, string | undefined>,
): AcceptanceTarget
export function acceptanceTargetFromEnv(environment?: NodeJS.ProcessEnv): AcceptanceTarget
