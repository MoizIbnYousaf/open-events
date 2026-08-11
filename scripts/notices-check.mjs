#!/usr/bin/env node
// Gate: the root LICENSE must carry the Apache License 2.0 text AND
// THIRD_PARTY_NOTICES.md must cite the pinned donor commit, list no unresolved
// rows, reference only existing destination files, and cover every source file
// that carries the donor-adaptation marker.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const PINNED = '1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592'
const MARKER = 'Adapted from ' + 'cloudflare-os'
const errors = []

const licensePath = resolve(root, 'LICENSE')
if (!existsSync(licensePath)) {
  errors.push('LICENSE missing (Apache-2.0 must be distributed)')
} else {
  const license = readFileSync(licensePath, 'utf8')
  const requiredLicenseSections = [
    'Apache License',
    'Version 2.0, January 2004',
    '1. Definitions.',
    '9. Accepting Warranty or Additional Liability.',
    'END OF TERMS AND CONDITIONS',
    'APPENDIX: How to apply the Apache License to your work.',
    'Copyright 2026 SpeakerOps contributors',
  ]
  for (const section of requiredLicenseSections) {
    if (!license.includes(section)) errors.push(`LICENSE section missing: ${section}`)
  }
}

const packagePath = resolve(root, 'package.json')
if (!existsSync(packagePath)) {
  errors.push('package.json missing')
} else {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (packageJson.license !== 'Apache-2.0') {
    errors.push('package.json license must be Apache-2.0')
  }
}

const noticesPath = resolve(root, 'THIRD_PARTY_NOTICES.md')
if (!existsSync(noticesPath)) {
  errors.push('THIRD_PARTY_NOTICES.md missing')
} else {
  const text = readFileSync(noticesPath, 'utf8')
  if (!text.includes(PINNED)) errors.push('pinned donor commit not cited')
  if (!text.includes('Apache-2.0')) errors.push('Apache-2.0 provenance not cited')
  if (text.includes('_pending_')) errors.push('unresolved provenance rows remain (_pending_)')

  const rows = [...text.matchAll(/^\|\s*(`[^`]+`|[^|]+?)\s*\|\s*(`[^`]+`|[^|]+?)\s*\|/gm)]
    .map((m) => [m[1], m[2]].map((s) => s.replace(/^`|`$/g, '').trim()))
    .filter(
      ([src, dest]) =>
        dest &&
        !dest.includes('---') &&
        !dest.includes('Destination path') &&
        !src.includes('Source path'),
    )

  const noticed = new Set()
  for (const [, dest] of rows) {
    if (dest.startsWith('_')) continue
    noticed.add(dest)
    const destPath = resolve(root, dest)
    if (!existsSync(destPath)) errors.push(`notice destination missing: ${dest}`)
  }

  const marked = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
        const rel = relative(root, path)
        if (readFileSync(path, 'utf8').includes(MARKER)) marked.push(rel)
      }
    }
  }
  for (const dir of ['src', 'scripts']) walk(resolve(root, dir))
  for (const file of ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts']) {
    const path = resolve(root, file)
    if (existsSync(path) && readFileSync(path, 'utf8').includes(MARKER)) marked.push(file)
  }
  for (const file of marked) {
    if (!noticed.has(file)) errors.push(`donor-marked file lacks notice row: ${file}`)
  }
}

if (errors.length) {
  console.error('notices:check failed:\n' + errors.map((e) => ' - ' + e).join('\n'))
  process.exit(1)
}
console.log('notices:check ok — Apache-2.0 LICENSE distributed; donor provenance complete.')
