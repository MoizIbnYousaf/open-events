import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('MaybeClerk suspense fallback', () => {
  it('does not remount the app tree as the Clerk lazy fallback', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'src', 'app', 'maybe-clerk.tsx'), 'utf8')
    expect(source).toContain('fallback={null}')
    expect(source).not.toContain('fallback={children}')
  })
})
