import { describe, expect, it } from 'vitest'

// @ts-expect-error — scripts/perf-check.mjs is plain ESM (narrow documented boundary).
import { checkBudgets, checkPurity, resolveRouteChunks } from '../../../scripts/perf-check.mjs'

// Manifest-driven performance contract: the CLI stays thin
// and the mapping/compare/purity logic lives in pure exported functions so
// fixtures can exercise every fail-closed seam without a real build. Each
// spec pins the public export surface and then asserts the real behavior.

const MANIFEST = {
  'index.html': {
    file: 'assets/index-abc123.js',
    dynamicImports: [
      'assets/start-abc123.js',
      'assets/cfp._eventSlug._formSlug-abc123.js',
      'assets/admin_.events._slug_.submissions-abc123.js',
      'assets/admin_.events._slug_.agenda-abc123.js',
      'assets/admin_.events._slug_.submissions_._submissionId-abc123.js',
    ],
  },
  'assets/start-abc123.js': { file: 'assets/start-abc123.js' },
  'assets/cfp._eventSlug._formSlug-abc123.js': {
    file: 'assets/cfp._eventSlug._formSlug-abc123.js',
  },
  'assets/admin_.events._slug_.submissions-abc123.js': {
    file: 'assets/admin_.events._slug_.submissions-abc123.js',
  },
  'assets/admin_.events._slug_.agenda-abc123.js': {
    file: 'assets/admin_.events._slug_.agenda-abc123.js',
  },
  'assets/admin_.events._slug_.submissions_._submissionId-abc123.js': {
    file: 'assets/admin_.events._slug_.submissions_._submissionId-abc123.js',
  },
} as const

const EXPECTED_ROUTE_CHUNKS = {
  '/start': 'assets/start-abc123.js',
  '/cfp/:eventSlug/:formSlug': 'assets/cfp._eventSlug._formSlug-abc123.js',
  '/admin/events/$slug/submissions': 'assets/admin_.events._slug_.submissions-abc123.js',
  '/admin/events/$slug/submissions/$submissionId':
    'assets/admin_.events._slug_.submissions_._submissionId-abc123.js',
  '/admin/events/$slug/agenda': 'assets/admin_.events._slug_.agenda-abc123.js',
} as const

describe('manifest-driven perf gate', () => {
  it('fails closed when the manifest is missing', () => {
    expect(resolveRouteChunks).toBeTypeOf('function')
    expect(() => resolveRouteChunks(undefined)).toThrow()
  })

  it('resolves every expected route chunk from dynamicImports (no routes-* glob)', () => {
    expect(resolveRouteChunks).toBeTypeOf('function')
    expect(resolveRouteChunks(MANIFEST)).toEqual(EXPECTED_ROUTE_CHUNKS)
  })

  it('reports an over-budget route chunk naming the route path', () => {
    expect(checkBudgets).toBeTypeOf('function')
    const violations: readonly string[] = checkBudgets({
      '/cfp/:eventSlug/:formSlug': 90 * 1024,
    })
    expect(violations.some((violation) => violation.includes('/cfp/:eventSlug/:formSlug'))).toBe(
      true,
    )
  })

  it('reports an over-budget main chunk', () => {
    expect(checkBudgets).toBeTypeOf('function')
    const violations: readonly string[] = checkBudgets({ main: 120 * 1024 })
    expect(violations.some((violation) => /main/i.test(violation))).toBe(true)
  })

  it('fails closed on an unknown/unattributed chunk in the manifest', () => {
    expect(resolveRouteChunks).toBeTypeOf('function')
    const unknownManifest = {
      ...MANIFEST,
      'index.html': {
        ...MANIFEST['index.html'],
        dynamicImports: [
          ...MANIFEST['index.html'].dynamicImports,
          'assets/unknown-route-abc123.js',
        ],
      },
    }
    expect(() => resolveRouteChunks(unknownManifest)).toThrow()
  })

  it('fails closed when an expected route chunk is missing from the manifest', () => {
    expect(resolveRouteChunks).toBeTypeOf('function')
    const missingManifest = {
      ...MANIFEST,
      'index.html': {
        ...MANIFEST['index.html'],
        dynamicImports: MANIFEST['index.html'].dynamicImports.filter((file) =>
          file.startsWith('assets/admin_'),
        ),
      },
    }
    expect(() => resolveRouteChunks(missingManifest)).toThrow()
  })

  it('passes an all-under-budget fixture with no violations (CLI prints the table)', () => {
    expect(checkBudgets).toBeTypeOf('function')
    const violations: readonly string[] = checkBudgets({
      main: 79 * 1024,
      '/start': 2 * 1024,
      '/cfp/:eventSlug/:formSlug': 5 * 1024,
      '/admin/events/$slug/submissions': 2 * 1024,
      '/admin/events/$slug/submissions/$submissionId': 2 * 1024,
      '/admin/events/$slug/agenda': 2 * 1024,
    })
    expect(violations).toEqual([])
  })

  it('fails closed when the main chunk contains a B-11 purity marker', () => {
    expect(checkPurity).toBeTypeOf('function')
    expect(checkPurity('export const x = 1\nimport { z } from "zod"')).not.toEqual([])
    expect(checkPurity('export const x = 1')).toEqual([])
  })
})
