export interface BuiltProductionReceipt {
  readonly worker: string
  readonly d1: string
  readonly r2: string
}

export function productionBuildEnv(
  environment?: Record<string, string | undefined>,
): Record<string, string | undefined>
export function validateBuiltProductionConfig(value: unknown): BuiltProductionReceipt
export function productionDeployArgs(revision: string, deploy: boolean): string[]
