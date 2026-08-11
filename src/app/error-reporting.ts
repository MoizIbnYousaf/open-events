/**
 * Every error a boundary catches is reported here before any friendly copy is
 * rendered. A boundary that shows a recovery surface without logging turns a
 * visible crash into a silent one, which is strictly worse than the white
 * screen it replaces.
 *
 * Mirrors the server convention in src/server/error.ts, which logs
 * 'unhandled API error' the same way.
 */
export function reportRouteCrash(
  error: unknown,
  info?: { componentStack?: string | null } | null,
): void {
  console.error('unhandled UI error', error, info?.componentStack ?? '')
}
