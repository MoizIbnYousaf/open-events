import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')

describe('acceptance showcase reset preflight', () => {
  it('cache-busts health by the expected exact release revision', () => {
    const source = readFileSync(resolve(ROOT, 'scripts/db-reset-showcase.mjs'), 'utf8')

    expect(source).toContain("healthUrl.searchParams.set('release', target.buildRevision)")
    expect(source).toContain("'cache-control': 'no-cache'")
  })
})
