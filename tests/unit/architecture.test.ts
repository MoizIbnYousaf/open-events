import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC_ROOT = join(REPO_ROOT, 'src')

const CORE_LAYERS = ['domain', 'application'] as const

/** Adapter layers, ordered from the pure core outward. */
const LAYER_RANK: Readonly<Record<string, number>> = {
  domain: 0,
  application: 0,
  db: 1,
  server: 2,
}

const FORBIDDEN_PACKAGE_PREFIXES = [
  'hono',
  'wrangler',
  '@cloudflare',
  'drizzle',
  'd1',
  'r2',
] as const

const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g

interface ImportRecord {
  readonly file: string
  readonly specifier: string
}

function walkSourceFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory).sort()) {
    const fullPath = join(directory, entry)
    if (statSync(fullPath).isDirectory()) {
      walkSourceFiles(fullPath, files)
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      files.push(fullPath)
    }
  }
  return files
}

function extractImports(sourcePath: string): ImportRecord[] {
  const source = readFileSync(sourcePath, 'utf8')
  const imports: ImportRecord[] = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2]
    if (specifier !== undefined) {
      imports.push({ file: sourcePath, specifier })
    }
  }
  return imports
}

function layerOf(sourcePath: string): string | null {
  const firstSegment = relative(SRC_ROOT, sourcePath).split('/')[0]
  return firstSegment === undefined ? null : firstSegment
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/')
}

function isForbiddenPackage(specifier: string): boolean {
  const normalized = specifier.split(/[?#]/, 1)[0] ?? specifier
  return FORBIDDEN_PACKAGE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  )
}

function isOutwardImport(file: string, specifier: string): boolean {
  if (isBareSpecifier(specifier)) {
    return false
  }

  const fromLayer = layerOf(file)
  const targetLayer = layerOf(resolve(dirname(file), specifier))
  if (fromLayer === null || targetLayer === null) {
    return true
  }

  const fromRank = LAYER_RANK[fromLayer]
  const targetRank = LAYER_RANK[targetLayer]
  return fromRank === undefined || targetRank === undefined || targetRank > fromRank
}

describe('architecture dependency direction', () => {
  const coreFiles = CORE_LAYERS.flatMap((layer) => walkSourceFiles(join(SRC_ROOT, layer)))
  const adapterFiles = walkSourceFiles(SRC_ROOT).filter((file) => {
    const layer = layerOf(file)
    return layer === 'db' || layer === 'server'
  })

  it('scans a non-empty, deterministic source file set', () => {
    expect(coreFiles.length).toBeGreaterThan(0)
    expect(adapterFiles.length).toBeGreaterThan(0)
  })

  it('keeps domain/application free of hono, wrangler, @cloudflare and drizzle/d1/r2 modules', () => {
    const violations = coreFiles
      .flatMap(extractImports)
      .filter(({ specifier }) => isBareSpecifier(specifier) && isForbiddenPackage(specifier))

    expect(violations).toEqual([])
  })

  it('keeps domain/application free of outward imports into src/db or src/server', () => {
    const violations = coreFiles
      .flatMap(extractImports)
      .filter(({ file, specifier }) => isOutwardImport(file, specifier))

    expect(violations).toEqual([])
  })

  it('lets src/db and src/server import inward but never outward', () => {
    const violations = adapterFiles
      .flatMap(extractImports)
      .filter(({ file, specifier }) => isOutwardImport(file, specifier))

    expect(violations).toEqual([])
  })
})
