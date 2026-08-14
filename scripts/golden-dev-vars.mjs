import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Ownership sentinel for the wrapper-generated .dev.vars (exact first line). */
export const DEV_VARS_SENTINEL = '# golden-dev-server-owned'

/**
 * Snapshot file name. It sits next to `.dev.vars` and is covered by the same
 * committed `.dev.vars*` ignore rule; the dash keeps it clear of the
 * `.dev.vars.<environment>` form the Workers toolchain reads.
 */
export const DEV_VARS_BACKUP_NAME = '.dev.vars-golden-backup'

/** True only when content begins with the exact sentinel line (no prefix collision). */
export function ownsDevVars(content) {
  return content === DEV_VARS_SENTINEL || content.startsWith(`${DEV_VARS_SENTINEL}\n`)
}

/** Emits the sentinel, the admin token, and the local dev vars; rejects CR/LF. */
export function devVarsContent(token) {
  if (token === undefined || token.length === 0) {
    throw new Error('LOCAL_ADMIN_TOKEN is required')
  }
  if (/[\r\n]/.test(token)) {
    throw new Error('LOCAL_ADMIN_TOKEN must not contain CR or LF')
  }
  return `${DEV_VARS_SENTINEL}\nLOCAL_ADMIN_TOKEN=${token}\nLOCAL_DEV_MODE=true\nALLOWED_ORIGINS=http://localhost:4173\n`
}

/** Absolute paths the wrapper owns under a repository root. */
export function devVarsPaths(root) {
  return {
    devVars: resolve(root, '.dev.vars'),
    backup: resolve(root, DEV_VARS_BACKUP_NAME),
  }
}

function readSnapshot(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    if (parsed.existed !== true) return { existed: false, content: null, mode: null }
    if (typeof parsed.content !== 'string') return null
    const mode = Number.isInteger(parsed.mode) ? parsed.mode : 0o600
    return { existed: true, content: parsed.content, mode }
  } catch {
    return null
  }
}

/**
 * Writes the wrapper-owned `.dev.vars` after snapshotting whatever was there.
 *
 * A previous run that was killed before it could restore leaves both its file
 * and its snapshot behind, so the snapshot is replayed first: the recorded
 * value is always the developer's own file, never a leaked wrapper one.
 * Returns the snapshot that `restoreDevVars` will replay.
 */
export function installDevVars(root, content) {
  const { devVars, backup } = devVarsPaths(root)
  restoreDevVars(root)

  const existed = existsSync(devVars)
  const snapshot = {
    existed,
    content: existed ? readFileSync(devVars, 'utf8') : null,
    mode: existed ? statSync(devVars).mode & 0o777 : null,
  }
  writeFileSync(backup, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })
  writeFileSync(devVars, content, { mode: 0o600 })
  return snapshot
}

/**
 * Replays the snapshot taken by `installDevVars`, then drops it. Idempotent and
 * safe to call from any exit path.
 *
 * - `'restored'` — the previous file was written back byte-for-byte.
 * - `'removed'`  — there was no previous file, so the wrapper file is gone.
 * - `'skipped'`  — `.dev.vars` is no longer wrapper-owned; it is left alone.
 * - `'noop'`     — nothing was installed, so there is nothing to undo.
 */
export function restoreDevVars(root) {
  const { devVars, backup } = devVarsPaths(root)
  if (!existsSync(backup)) return 'noop'

  if (existsSync(devVars) && !ownsDevVars(readFileSync(devVars, 'utf8'))) {
    rmSync(backup, { force: true })
    return 'skipped'
  }

  const snapshot = readSnapshot(backup)
  let outcome
  if (snapshot !== null && snapshot.existed) {
    writeFileSync(devVars, snapshot.content, { mode: snapshot.mode })
    outcome = 'restored'
  } else {
    // No previous file, or an unreadable snapshot: the only file that can be
    // here is the wrapper's own, and leaving it behind is what poisons later
    // runs — so it goes.
    rmSync(devVars, { force: true })
    outcome = 'removed'
  }
  rmSync(backup, { force: true })
  return outcome
}
