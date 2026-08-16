/**
 * Acceptance runs keep immutable abuse-budget evidence, so each guarded run
 * needs fresh recipients. Local golden runs stay deterministic.
 */
export function liveTestEmail(localPart: string): string {
  const runId = process.env.LIVE_RUN_ID
  return `${localPart}${runId === undefined ? '' : `+${runId}`}@example.test`
}
