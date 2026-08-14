import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// @ts-expect-error — scripts/golden-dev-vars.mjs is plain ESM (narrow documented boundary).
import * as goldenDevVarsModule from '../../../scripts/golden-dev-vars.mjs'

const {
  DEV_VARS_SENTINEL,
  devVarsContent,
  devVarsPaths,
  installDevVars,
  ownsDevVars,
  restoreDevVars,
} = goldenDevVarsModule

describe('golden-dev-vars ownership and content helpers', () => {
  it('ownsDevVars is exact-sentinel aware (no prefix collisions)', () => {
    expect(ownsDevVars(`${DEV_VARS_SENTINEL}\nLOCAL_ADMIN_TOKEN=x`)).toBe(true)
    expect(ownsDevVars(DEV_VARS_SENTINEL)).toBe(true)
    // Prefix collision: a longer marker must not be owned.
    expect(ownsDevVars(`${DEV_VARS_SENTINEL}-other\nLOCAL_ADMIN_TOKEN=x`)).toBe(false)
    expect(ownsDevVars('LOCAL_ADMIN_TOKEN=x')).toBe(false)
    expect(ownsDevVars('')).toBe(false)
  })

  it('devVarsContent emits the exact sentinel line and all local vars', () => {
    const content = devVarsContent('s3b-local-test')
    expect(content.startsWith(`${DEV_VARS_SENTINEL}\n`)).toBe(true)
    expect(content).toContain('LOCAL_ADMIN_TOKEN=s3b-local-test')
    expect(content).toContain('LOCAL_DEV_MODE=true')
    expect(content).toContain('ALLOWED_ORIGINS=http://localhost:4173')
  })

  it('devVarsContent rejects a missing token and CR/LF injection', () => {
    expect(() => devVarsContent(undefined)).toThrow('LOCAL_ADMIN_TOKEN is required')
    expect(() => devVarsContent('')).toThrow('LOCAL_ADMIN_TOKEN is required')
    expect(() => devVarsContent('bad\ntoken')).toThrow('must not contain CR or LF')
    expect(() => devVarsContent('bad\rtoken')).toThrow('must not contain CR or LF')
  })
})

describe('golden-dev-vars install/restore lifecycle', () => {
  const OURS = devVarsContent('local-test')
  const THEIRS =
    'LOCAL_ADMIN_TOKEN=a-developers-own-secret\nALLOWED_ORIGINS=http://localhost:8787\n'

  let root: string
  let devVars: string
  let backup: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'golden-dev-vars-'))
    const paths = devVarsPaths(root)
    devVars = paths.devVars
    backup = paths.backup
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('installs the wrapper file and removes it again when there was none before', () => {
    installDevVars(root, OURS)
    expect(readFileSync(devVars, 'utf8')).toBe(OURS)
    expect(ownsDevVars(readFileSync(devVars, 'utf8'))).toBe(true)
    expect(statSync(devVars).mode & 0o777).toBe(0o600)
    expect(existsSync(backup)).toBe(true)

    expect(restoreDevVars(root)).toBe('removed')
    expect(existsSync(devVars)).toBe(false)
    expect(existsSync(backup)).toBe(false)
  })

  it("restores a developer's own file byte-for-byte instead of deleting it", () => {
    writeFileSync(devVars, THEIRS, { mode: 0o600 })

    installDevVars(root, OURS)
    expect(readFileSync(devVars, 'utf8')).toBe(OURS)

    expect(restoreDevVars(root)).toBe('restored')
    expect(readFileSync(devVars, 'utf8')).toBe(THEIRS)
    expect(statSync(devVars).mode & 0o777).toBe(0o600)
    expect(existsSync(backup)).toBe(false)
  })

  it('is idempotent: restoring twice is safe and the second call does nothing', () => {
    writeFileSync(devVars, THEIRS)
    installDevVars(root, OURS)

    expect(restoreDevVars(root)).toBe('restored')
    expect(restoreDevVars(root)).toBe('noop')
    expect(readFileSync(devVars, 'utf8')).toBe(THEIRS)
  })

  it('recovers a snapshot left behind by a run that was killed before restoring', () => {
    writeFileSync(devVars, THEIRS)
    installDevVars(root, OURS)
    // Simulated hard kill: the wrapper file and its snapshot both survive.
    expect(readFileSync(devVars, 'utf8')).toBe(OURS)
    expect(existsSync(backup)).toBe(true)

    // The next run must snapshot the developer's file, not the leaked one.
    installDevVars(root, OURS)
    expect(restoreDevVars(root)).toBe('restored')
    expect(readFileSync(devVars, 'utf8')).toBe(THEIRS)
  })

  it('never clobbers a file that is no longer wrapper-owned', () => {
    installDevVars(root, OURS)
    const replacement = 'LOCAL_ADMIN_TOKEN=written-during-the-run\n'
    writeFileSync(devVars, replacement)

    expect(restoreDevVars(root)).toBe('skipped')
    expect(readFileSync(devVars, 'utf8')).toBe(replacement)
    expect(existsSync(backup)).toBe(false)
  })

  it('removes the wrapper file when the snapshot cannot be read', () => {
    installDevVars(root, OURS)
    writeFileSync(backup, 'not json at all')

    expect(restoreDevVars(root)).toBe('removed')
    expect(existsSync(devVars)).toBe(false)
    expect(existsSync(backup)).toBe(false)
  })

  it('exposes wrapper-owned paths under the given root', () => {
    expect(devVarsPaths(root).devVars).toBe(join(root, '.dev.vars'))
    expect(devVarsPaths(root).backup).not.toBe(devVarsPaths(root).devVars)
    // The snapshot is covered by the committed `.dev.vars*` ignore rule.
    expect(devVarsPaths(root).backup.startsWith(join(root, '.dev.vars'))).toBe(true)
  })
})
