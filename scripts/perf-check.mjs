#!/usr/bin/env node
// Gate: manifest-driven per-route gzip budgets (fail closed; no routes-* glob).
import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BUDGETS = {
  main: 100 * 1024,
  '/start': 20 * 1024,
  '/cfp/:eventSlug/:formSlug': 80 * 1024,
  '/admin/events/$slug/submissions': 30 * 1024,
  '/admin/events/$slug/submissions/$submissionId': 40 * 1024,
}

const PURITY_MARKERS = ['dnd-kit', 'react-hook-form', 'zod', 'lucide']

// TanStack autoCodeSplitting emits manifest keys like
// "src/app/routes/_public/start.tsx?tsr-split=component"; fixtures may use
// plain "assets/start-<hash>.js" names. Normalize both to the route basename.
function chunkBaseName(file) {
  const pathPart = String(file).split('?')[0]
  const base = pathPart.split('/').pop() ?? ''
  // Built-asset fixture forms ("start-<hash>.js") strip the hash; source
  // forms keep the ".tsx" so the manifest chunk table can map them.
  return base.endsWith('.tsx') ? base : base.replace(/-[A-Za-z0-9_-]+\.js$/, '')
}

// Route chunks the gate budgets; any other TanStack-split route module is
// known but not budgeted here (e.g. index/_public/admin/login/builder routes).
const KNOWN_ROUTE_BASENAMES = new Set([
  'index.tsx',
  'routes',
  '_public.tsx',
  '_public',
  'admin.tsx',
  'admin',
  'admin_.events.$slug.tsx',
  'admin_.events._slug',
  'admin_.events.$slug_.taxonomies.tsx',
  'admin_.events._slug_.taxonomies',
  'admin_.forms.$formId.tsx',
  'admin_.forms._formId',
  'admin_.forms.$formId_.versions.$versionId.tsx',
  'admin_.forms._formId_.versions._versionId',
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
    const chunkEntry = manifest[file]
    const base = chunkBaseName(chunkEntry?.file ?? file)
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

  const violations = checkBudgets(chunkSizes)
  const purity = checkPurity(readFileSync(join(assetsDir, mainFile.split('/').pop() ?? ''), 'utf8'))
  if (purity.length > 0) {
    violations.push(`main chunk contains B-11 purity markers: ${purity.join(', ')}`)
  }

  console.log('perf:check — per-route gzip (kB):')
  for (const [route, size] of Object.entries(chunkSizes)) {
    console.log(`  ${route}: ${(size / 1024).toFixed(1)}`)
  }
  if (violations.length > 0) {
    console.error(
      'perf:check failed:\n' + violations.map((violation) => ` - ${violation}`).join('\n'),
    )
    process.exit(1)
  }
  console.log('perf:check ok — all chunks within budget, main purity clean')
}
