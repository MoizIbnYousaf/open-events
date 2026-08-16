export interface BuiltAcceptanceReceipt {
  readonly worker: string
  readonly d1: string
  readonly r2: string
  readonly rateLimitNamespaces: readonly string[]
}

export function validateBuiltAcceptanceConfig(value: unknown): BuiltAcceptanceReceipt
export function acceptanceBuildEnv(
  environment?: Record<string, string | undefined>,
): Record<string, string | undefined>
export function assertNoLocalDevVars(root: string): void
export function assertNoBuiltDevVars(root: string): void
export function acceptanceDeployArgs(revision: string, deploy: boolean): string[]
