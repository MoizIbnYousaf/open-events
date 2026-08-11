/**
 * The approval trail an organizer reads on a file: older copies first, the
 * current one last. A list of isolated version numbers is a log; an arrowed
 * trail is the change history the content rubric asks for.
 */
export function versionApprovalTrail(
  versions: readonly { readonly version: number; readonly current: boolean }[],
): string {
  return [...versions]
    .sort((left, right) => left.version - right.version)
    .map((row) => `v${row.version}${row.current ? ' (current)' : ''}`)
    .join(' → ')
}
