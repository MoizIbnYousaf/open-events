import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// @ts-expect-error — scripts/db-reset.mjs is plain ESM (narrow documented boundary).
import { wranglerCommand } from '../../../scripts/db-reset.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('db-reset wrangler launch', () => {
  it('runs wrangler itself, with no package manager in between', () => {
    const { command, wranglerBin } = wranglerCommand(REPO_ROOT)

    expect(command).toBe(process.execPath)
    expect(existsSync(wranglerBin)).toBe(true)
    expect(wranglerBin.endsWith('wrangler.js')).toBe(true)
  })

  it('does not spawn pnpm to reach wrangler', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'scripts', 'db-reset.mjs'), 'utf8')
    expect(source).not.toMatch(/spawnSync\(\s*['"]pnpm['"]/)
    expect(source).toContain('wrangler/package.json')
  })
})

describe('pnpm allowBuilds for the e2e path', () => {
  it('declares a boolean for @clerk/shared so pnpm e2e is not blocked', () => {
    const workspace = readFileSync(resolve(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')
    expect(workspace).toMatch(/['"]@clerk\/shared['"]:\s*false/)
    expect(workspace).not.toMatch(/set this to true or false/)
  })
})
