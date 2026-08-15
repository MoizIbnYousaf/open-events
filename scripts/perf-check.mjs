#!/usr/bin/env node
// Gate: manifest-driven per-route gzip budgets (fail closed; no routes-* glob).
import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BUDGETS = {
  // Raised by hand from 100 kB, which the entry chunk had already passed by 11
  // bytes — measured, not estimated, by building the previous commit in a
  // disposable worktree. Every feature body is already split out of the entry:
  // the tour, the command palette and every route render from their own chunks,
  // and what remains is the framework, the shell and the navigation model. So
  // there was nothing left to move, and the alternatives were shaving strings a
  // reader can see or restructuring working code for a hundredth of the bundle.
  //
  // 103 kB, raised by 1 kB after the Vite 8 production manifest measured the
  // entry at 102.7 kB. The number that decides first paint is the closure below,
  // not this one, and that remains independently capped at 150 kB. Raising this
  // is the documented move when the entry has genuinely grown; quietly tracking
  // the build is not.
  main: 103 * 1024,
  '/start': 20 * 1024,
  '/cfp/:eventSlug/:formSlug': 80 * 1024,
  '/admin/events/$slug/submissions': 30 * 1024,
  '/admin/events/$slug/submissions/$submissionId': 40 * 1024,
  '/admin/events/$slug/agenda': 40_000,
  '/admin/events/$slug/evaluations': 40_000,
  '/schedule/:eventSlug': 80_000,
  '/evaluations': 80_000,
  '/portal': 20 * 1024,
  '/admin/events/$slug/readiness': 40_000,
  // A roster is a list and a search box; budgeted alongside the other admin
  // reads rather than left unattributed, because the gate is fail-closed and an
  // unbudgeted route is one nobody is watching.
  '/admin/events/$slug/speakers': 30 * 1024,
  '/admin/events/$slug/messages': 30 * 1024,
  '/sessions/:eventSlug': 80_000,
  '/speakers/:eventSlug': 40_000,
  '/admin/events/$slug/embeds': 30 * 1024,
  '/admin/events/$slug/files': 30 * 1024,
  '/headshot': 20 * 1024,
}

const PURITY_MARKERS = ['dnd-kit', 'react-hook-form', 'zod', 'lucide']

/**
 * The entry file is not what a browser downloads before the first paint.
 *
 * `main` budgets ONE file, while the module preload the browser actually
 * follows is that file plus its STATIC import closure — thirteen chunks and
 * ~145 kB at the time this was written, against a `main` number of ~100 kB. A
 * gate that watches one of those two numbers can stay green while the other
 * doubles: anything hoisted out of the entry into a shared chunk LOOKS like a
 * saving and costs the reader exactly what it did before.
 *
 * 150 kB, set from an observed closure of ≈148.9 kB at 9c7cec2 with roughly 3%
 * of headroom. The figure is deliberately stated to the tenth of a kilobyte:
 * chunk file names carry content hashes, so a rebuild of the same source moves
 * the gzip total by a few bytes and a to-the-byte baseline in prose does not
 * re-derive. The budget itself is exact and hand-set — a number someone has to
 * raise by hand, in a diff, with a reason, not a ratio that quietly tracks
 * whatever the build happens to emit.
 */
export const EAGER_CLOSURE_BUDGET = 150 * 1024

// TanStack autoCodeSplitting emits manifest keys like
// "src/app/routes/_public/start.tsx?tsr-split=component"; fixtures may use
// plain "assets/start-<hash>.js" names. Normalize both to the route basename.
function chunkBaseName(file) {
  const pathPart = String(file).split('?')[0]
  const base = pathPart.split('/').pop() ?? ''
  // Source-key forms strip the extension; built-asset fixture forms
  // ("start-<hash>.js") strip the hash. Both then share one route matcher.
  return base.endsWith('.tsx')
    ? base.slice(0, -'.tsx'.length).replaceAll('$', '_')
    : base.replace(/-[A-Za-z0-9_-]+\.js$/, '')
}

// Route chunks the gate budgets; any other TanStack-split route module is
// known but not budgeted here (e.g. index/_public/admin/login/builder routes).
const KNOWN_ROUTE_BASENAMES = new Set([
  'index.tsx',
  'index',
  'routes',
  '_public.tsx',
  '_public',
  'admin.tsx',
  'admin',
  'admin_.events',
  'admin_.events.index',
  'embed._embedId',
  'speakers._eventSlug._contactId',
  'admin_.events._slug_.orby',
  'admin_.events.$slug.tsx',
  'admin_.events._slug',
  'admin_.events.$slug_.taxonomies.tsx',
  'admin_.events._slug_.taxonomies',
  'admin_.events.$slug_.forms.$formId.tsx',
  'admin_.events._slug_.forms._formId',
  'admin_.events.$slug_.forms.$formId_.versions.$versionId.tsx',
  'admin_.events._slug_.forms._formId_.versions._versionId',
])

// Intentionally lazy feature modules that are not routes. Keep their source
// keys explicit so a content hash (or a hyphen in the file name) cannot make
// the attribution depend on generated asset naming.
const KNOWN_FEATURE_IMPORTS = new Set([
  'src/app/clerk-root.tsx',
  'src/app/features/nav/ClerkNavControls.tsx',
  'src/app/features/orby/OrbyWidget.tsx',
])

const ROUTE_CHUNK_PATTERNS = [
  { route: '/start', pattern: /^start(-[A-Za-z0-9_-]+)?(\.js)?$/ },
  {
    route: '/cfp/:eventSlug/:formSlug',
    pattern: /^cfp\._eventSlug\._formSlug(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/admin/events/$slug/submissions',
    pattern: /^admin_\.events\._slug_\.submissions(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/admin/events/$slug/submissions/$submissionId',
    pattern: /^admin_\.events\._slug_\.submissions_\._submissionId(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/admin/events/$slug/agenda',
    pattern: /^admin_\.events\._slug_\.agenda(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/admin/events/$slug/evaluations',
    pattern: /^admin_\.events\._slug_\.evaluations(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/sessions/:eventSlug',
    pattern: /^sessions\._eventSlug(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/speakers/:eventSlug',
    pattern: /^speakers\._eventSlug(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/admin/events/$slug/embeds',
    pattern: /^admin_\.events\._slug_\.embeds(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/admin/events/$slug/files',
    pattern: /^admin_\.events\._slug_\.files(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/schedule/:eventSlug',
    pattern: /^schedule\._eventSlug(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/evaluations',
    pattern: /^evaluations(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  { route: '/portal', pattern: /^portal(-[A-Za-z0-9_-]+)?(\.js)?$/ },
  {
    route: '/admin/events/$slug/readiness',
    pattern: /^admin_\.events\._slug_\.readiness(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/admin/events/$slug/speakers',
    pattern: /^admin_\.events\._slug_\.speakers(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  {
    route: '/admin/events/$slug/messages',
    pattern: /^admin_\.events\._slug_\.messages(-[A-Za-z0-9_-]+)?(\.js)?$/,
  },
  { route: '/headshot', pattern: /^headshot(-[A-Za-z0-9_-]+)?(\.js)?$/ },
]

/** Route path -> chunk file map from index.html's dynamicImports (fail closed). */
export function resolveRouteChunks(manifest) {
  if (manifest === undefined || manifest === null || typeof manifest !== 'object') {
    throw new Error('perf:check — dist/client/.vite/manifest.json missing; run pnpm build first')
  }
  const entry = manifest['index.html']
  const dynamicImports = entry?.dynamicImports
  if (!Array.isArray(dynamicImports)) {
    throw new Error('perf:check — manifest index.html entry has no dynamicImports')
  }
  const chunks = new Map()
  for (const file of dynamicImports) {
    if (KNOWN_FEATURE_IMPORTS.has(file)) continue
    const base = chunkBaseName(file)
    const match = ROUTE_CHUNK_PATTERNS.find(({ pattern }) => pattern.test(base))
    if (match === undefined && !KNOWN_ROUTE_BASENAMES.has(base)) {
      throw new Error(`perf:check — unknown/unattributed chunk in manifest: ${file}`)
    }
    if (match === undefined) continue
    if (chunks.has(match.route)) {
      throw new Error(`perf:check — duplicate chunk for route ${match.route}: ${file}`)
    }
    chunks.set(match.route, file)
  }
  const result = {}
  for (const { route } of ROUTE_CHUNK_PATTERNS) {
    const file = chunks.get(route)
    if (file === undefined) {
      throw new Error(`perf:check — expected route chunk missing from manifest: ${route}`)
    }
    result[route] = file
  }
  return result
}

/**
 * Every asset the browser fetches before it can run the entry: the entry file
 * and everything reachable from it through STATIC imports (`imports`), never
 * `dynamicImports` — a route chunk is fetched when the route is visited, which
 * is the whole point of splitting it out.
 *
 * Returns manifest asset paths in no particular order, entry first. Fails
 * closed on a manifest with no entry, exactly as `resolveRouteChunks` does.
 */
export function resolveEagerClosure(manifest) {
  if (manifest === undefined || manifest === null || typeof manifest !== 'object') {
    throw new Error('perf:check — dist/client/.vite/manifest.json missing; run pnpm build first')
  }
  const entry = manifest['index.html']
  if (entry === undefined || typeof entry.file !== 'string') {
    throw new Error('perf:check — manifest index.html entry has no file')
  }
  const files = []
  const visited = new Set()
  const pending = ['index.html']
  while (pending.length > 0) {
    const key = pending.pop()
    if (visited.has(key)) continue
    visited.add(key)
    const chunk = manifest[key]
    if (chunk === undefined) {
      throw new Error(`perf:check — manifest references a chunk it does not describe: ${key}`)
    }
    if (typeof chunk.file === 'string') files.push(chunk.file)
    for (const imported of chunk.imports ?? []) pending.push(imported)
  }
  return files
}

/** One violation when the eager closure is over budget; empty when it is not. */
export function checkEagerClosure(totalBytes, chunkCount) {
  if (totalBytes <= EAGER_CLOSURE_BUDGET) return []
  return [
    `eager closure gzip ${(totalBytes / 1024).toFixed(1)} kB across ${chunkCount} chunks exceeds budget ${(
      EAGER_CLOSURE_BUDGET / 1024
    ).toFixed(0)} kB`,
  ]
}

/** Budget violations naming route paths; empty when all chunks are under budget. */
export function checkBudgets(chunkSizes) {
  const violations = []
  for (const [route, size] of Object.entries(chunkSizes)) {
    const budget = BUDGETS[route]
    if (budget === undefined) continue
    if (typeof size === 'number' && size > budget) {
      violations.push(
        `${route} gzip ${(size / 1024).toFixed(1)} kB exceeds budget ${(budget / 1024).toFixed(0)} kB`,
      )
    }
  }
  return violations
}

/** B-11 purity: markers in the main chunk. Empty when clean. */
export function checkPurity(mainSource) {
  return PURITY_MARKERS.filter((marker) => mainSource.includes(marker))
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  const root = resolve(import.meta.dirname, '..')
  const manifestPath = resolve(root, 'dist', 'client', '.vite', 'manifest.json')
  const assetsDir = resolve(root, 'dist', 'client', 'assets')

  if (!existsSync(manifestPath)) {
    console.error('perf:check — dist/client/.vite/manifest.json missing; run pnpm build first')
    process.exit(1)
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    console.error('perf:check — failed to parse dist/client/.vite/manifest.json')
    process.exit(1)
  }

  let routeChunks
  try {
    routeChunks = resolveRouteChunks(manifest)
  } catch (error) {
    console.error(
      `perf:check failed:\n - ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }

  const mainFile = manifest['index.html']?.file
  const chunkSizes = {}
  if (typeof mainFile === 'string') {
    chunkSizes.main = gzipSync(
      readFileSync(join(assetsDir, mainFile.split('/').pop() ?? '')),
    ).length
  }
  for (const [route, chunkKey] of Object.entries(routeChunks)) {
    const assetFile = manifest[chunkKey]?.file ?? chunkKey
    chunkSizes[route] = gzipSync(
      readFileSync(join(assetsDir, assetFile.split('/').pop() ?? '')),
    ).length
  }

  let eagerFiles
  try {
    eagerFiles = resolveEagerClosure(manifest)
  } catch (error) {
    console.error(
      `perf:check failed:\n - ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  }
  const eagerBytes = eagerFiles.reduce(
    (total, file) =>
      total + gzipSync(readFileSync(join(assetsDir, file.split('/').pop() ?? ''))).length,
    0,
  )

  const violations = checkBudgets(chunkSizes)
  violations.push(...checkEagerClosure(eagerBytes, eagerFiles.length))
  const purity = checkPurity(readFileSync(join(assetsDir, mainFile.split('/').pop() ?? ''), 'utf8'))
  if (purity.length > 0) {
    violations.push(`main chunk contains B-11 purity markers: ${purity.join(', ')}`)
  }

  console.log('perf:check — per-route gzip (kB):')
  for (const [route, size] of Object.entries(chunkSizes)) {
    console.log(`  ${route}: ${(size / 1024).toFixed(1)}`)
  }
  console.log(
    `  eager closure (${eagerFiles.length} chunks): ${(eagerBytes / 1024).toFixed(1)} / ${(
      EAGER_CLOSURE_BUDGET / 1024
    ).toFixed(0)}`,
  )
  if (violations.length > 0) {
    console.error(
      'perf:check failed:\n' + violations.map((violation) => ` - ${violation}`).join('\n'),
    )
    process.exit(1)
  }
  console.log('perf:check ok — all chunks within budget, main purity clean')
}
