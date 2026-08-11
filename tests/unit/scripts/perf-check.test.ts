import { describe, expect, it } from 'vitest'

// @ts-expect-error — scripts/perf-check.mjs is plain ESM (narrow documented boundary).
import * as perf from '../../../scripts/perf-check.mjs'

const {
  EAGER_CLOSURE_BUDGET,
  checkBudgets,
  checkEagerClosure,
  checkPurity,
  resolveEagerClosure,
  resolveRouteChunks,
} = perf

// Manifest-driven perf-gate contract: keep the CLI thin and exercise the
// mapping, budget, and purity logic through pure exported functions so
// fixtures cover each fail-closed seam without requiring a real build.

const MANIFEST = {
  'index.html': {
    file: 'assets/index-abc123.js',
    dynamicImports: [
      'assets/start-abc123.js',
      'assets/cfp._eventSlug._formSlug-abc123.js',
      'assets/admin_.events._slug_.submissions-abc123.js',
      'assets/admin_.events._slug_.agenda-abc123.js',
      'assets/schedule._eventSlug-abc123.js',
      'assets/evaluations-abc123.js',
      'assets/portal-abc123.js',
      'assets/headshot-abc123.js',
      'assets/admin_.events._slug_.submissions_._submissionId-abc123.js',
      'assets/admin_.events._slug_.readiness-abc123.js',
      'assets/admin_.events._slug_.evaluations-abc123.js',
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
  'assets/schedule._eventSlug-abc123.js': {
    file: 'assets/schedule._eventSlug-abc123.js',
  },
  'assets/evaluations-abc123.js': {
    file: 'assets/evaluations-abc123.js',
  },
  'assets/portal-abc123.js': { file: 'assets/portal-abc123.js' },
  'assets/headshot-abc123.js': { file: 'assets/headshot-abc123.js' },
  'assets/admin_.events._slug_.submissions_._submissionId-abc123.js': {
    file: 'assets/admin_.events._slug_.submissions_._submissionId-abc123.js',
  },
  'assets/admin_.events._slug_.readiness-abc123.js': {
    file: 'assets/admin_.events._slug_.readiness-abc123.js',
  },
  'assets/admin_.events._slug_.evaluations-abc123.js': {
    file: 'assets/admin_.events._slug_.evaluations-abc123.js',
  },
} as const

const EXPECTED_ROUTE_CHUNKS = {
  '/start': 'assets/start-abc123.js',
  '/cfp/:eventSlug/:formSlug': 'assets/cfp._eventSlug._formSlug-abc123.js',
  '/admin/events/$slug/submissions': 'assets/admin_.events._slug_.submissions-abc123.js',
  '/admin/events/$slug/submissions/$submissionId':
    'assets/admin_.events._slug_.submissions_._submissionId-abc123.js',
  '/admin/events/$slug/agenda': 'assets/admin_.events._slug_.agenda-abc123.js',
  '/schedule/:eventSlug': 'assets/schedule._eventSlug-abc123.js',
  '/evaluations': 'assets/evaluations-abc123.js',
  '/portal': 'assets/portal-abc123.js',
  '/admin/events/$slug/readiness': 'assets/admin_.events._slug_.readiness-abc123.js',
  '/admin/events/$slug/evaluations': 'assets/admin_.events._slug_.evaluations-abc123.js',
  '/headshot': 'assets/headshot-abc123.js',
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

  it('reports an over-budget readiness route chunk naming the route path', () => {
    expect(checkBudgets).toBeTypeOf('function')
    const violations: readonly string[] = checkBudgets({
      '/admin/events/$slug/readiness': 90 * 1024,
    })
    expect(
      violations.some((violation) => violation.includes('/admin/events/$slug/readiness')),
    ).toBe(true)
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

  it('recognizes canonical event-scoped form-builder route chunks', () => {
    const eventScopedBuilder = {
      ...MANIFEST,
      'index.html': {
        ...MANIFEST['index.html'],
        dynamicImports: [
          ...MANIFEST['index.html'].dynamicImports,
          'src/app/routes/admin_.events.$slug_.forms.$formId.tsx?tsr-split=component',
          'src/app/routes/admin_.events.$slug_.forms.$formId_.versions.$versionId.tsx?tsr-split=component',
        ],
      },
      'src/app/routes/admin_.events.$slug_.forms.$formId.tsx?tsr-split=component': {
        file: 'assets/admin_.events._slug_.forms._formId-abc123.js',
      },
      'src/app/routes/admin_.events.$slug_.forms.$formId_.versions.$versionId.tsx?tsr-split=component':
        {
          file: 'assets/admin_.events._slug_.forms._formId_.versions._versionId-abc123.js',
        },
    }

    expect(resolveRouteChunks(eventScopedBuilder)).toEqual(EXPECTED_ROUTE_CHUNKS)
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
      '/schedule/:eventSlug': 2 * 1024,
      '/evaluations': 2 * 1024,
      '/portal': 2 * 1024,
      '/admin/events/$slug/readiness': 2 * 1024,
      '/headshot': 2 * 1024,
    })
    expect(violations).toEqual([])
  })

  it('fails closed when the main chunk contains a B-11 purity marker', () => {
    expect(checkPurity).toBeTypeOf('function')
    expect(checkPurity('export const x = 1\nimport { z } from "zod"')).not.toEqual([])
    expect(checkPurity('export const x = 1')).toEqual([])
  })

  // V5-N1: `main` budgets one file, while the browser fetches that file plus
  // its static import closure before the first paint. A gate watching only the
  // first number stays green while the second one doubles.
  describe('eager import closure', () => {
    const CLOSURE_MANIFEST = {
      'index.html': {
        file: 'assets/index-abc123.js',
        imports: ['_shared-abc123.js'],
        dynamicImports: ['assets/start-abc123.js'],
      },
      '_shared-abc123.js': {
        file: 'assets/shared-abc123.js',
        imports: ['_deep-abc123.js'],
      },
      '_deep-abc123.js': { file: 'assets/deep-abc123.js' },
      // Reached only through a dynamic import: fetched when the route is
      // visited, which is what splitting it out was for.
      'assets/start-abc123.js': { file: 'assets/start-abc123.js' },
    } as const

    it('walks static imports transitively and never follows a dynamic one', () => {
      expect(resolveEagerClosure).toBeTypeOf('function')
      expect(resolveEagerClosure(CLOSURE_MANIFEST).sort()).toEqual([
        'assets/deep-abc123.js',
        'assets/index-abc123.js',
        'assets/shared-abc123.js',
      ])
    })

    it('terminates on a cyclic import graph instead of walking forever', () => {
      const cyclic = {
        'index.html': { file: 'assets/index-abc123.js', imports: ['_a.js'] },
        '_a.js': { file: 'assets/a.js', imports: ['_b.js'] },
        '_b.js': { file: 'assets/b.js', imports: ['_a.js'] },
      }
      expect(resolveEagerClosure(cyclic).sort()).toEqual([
        'assets/a.js',
        'assets/b.js',
        'assets/index-abc123.js',
      ])
    })

    it('fails closed on a missing manifest and on a chunk the manifest omits', () => {
      expect(() => resolveEagerClosure(undefined)).toThrow()
      expect(() =>
        resolveEagerClosure({ 'index.html': { file: 'assets/index.js', imports: ['_gone.js'] } }),
      ).toThrow(/does not describe/)
    })

    it('reports an over-budget closure and stays silent under the budget', () => {
      expect(checkEagerClosure).toBeTypeOf('function')
      expect(checkEagerClosure(EAGER_CLOSURE_BUDGET, 13)).toEqual([])
      const violations: readonly string[] = checkEagerClosure(EAGER_CLOSURE_BUDGET + 1, 13)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatch(/eager closure/)
      expect(violations[0]).toMatch(/13 chunks/)
    })

    it('pins the budget as an explicit number someone has to raise by hand', () => {
      expect(EAGER_CLOSURE_BUDGET).toBe(153600)
    })
  })
})
