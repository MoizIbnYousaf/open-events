/**
 * Dynamic-import boundary for the agenda drag/drop board. dnd-kit is loaded
 * only on demand through this loader, so it never enters the main shell chunk
 * (the perf purity marker in scripts/perf-check.mjs) and never becomes a
 * static import in the agenda route chunk. The loader returns the import
 * promise (a thenable) for the future board surface.
 */
export function loadAgendaDndBoard(): Promise<unknown> {
  return import('@dnd-kit/core')
}
