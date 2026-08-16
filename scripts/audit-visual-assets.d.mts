export const APPROVED_VISUAL_ASSETS: readonly string[]

export function shippedVisualAssets(root: string): string[]

export function auditVisualAssets(root: string, approvedAssets?: readonly string[]): string[]

export function runVisualAssetAudit(root?: string): string[]
