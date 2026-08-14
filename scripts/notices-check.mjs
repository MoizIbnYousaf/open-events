#!/usr/bin/env node
// Gate: the root LICENSE must carry the Apache License 2.0 text AND
// THIRD_PARTY_NOTICES.md must cite the pinned donor commit, list no unresolved
// rows, reference only existing destination files, cover every source file that
// carries the donor-adaptation marker, and cover every file that ships copied
// glyph artwork.
//
// The marker walk alone is provenance in ONE direction: it proves a marked file
// has a row, never that a file which needs a row carries one. Inline SVG path
// data is the class of donation that leaves no marker — a single `<path d="…">`
// pasted into a primitive is a complete copy of an upstream drawing, and the
// entry-chunk purity rule actively encourages inlining, so this is the shape
// the project produces on purpose. The artwork walk closes that direction:
// every file containing path data must either be a notices destination or be
// named in FIRST_PARTY_ARTWORK, which is a list a reviewer has to edit by hand.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PINNED = '1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592'
const MARKER = 'Adapted from ' + 'cloudflare-os'

/** Every tree that can ship product or harness code, not just `src`. */
const WALKED_DIRECTORIES = ['src', 'scripts', 'tests', 'e2e']
const WALKED_ROOT_FILES = [
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'playwright.golden.config.ts',
  'playwright.live.config.ts',
  'drizzle.config.ts',
  'eslint.config.js',
]
const WALKED_EXTENSIONS = /\.(ts|tsx|mjs|js|css)$/

/**
 * SVG path data in any of the FOUR forms this codebase can ship it: a JSX
 * `<path>` element, a `d="M…"`/`d="m…"` attribute (the coordinate class after
 * the command is what keeps `id="main"` out), the percent-encoded form inside a
 * CSS `url("data:image/svg+xml,…")` token — and a BARE STRING LITERAL.
 *
 * The fourth was the blind spot, and it is the form this codebase actually
 * prefers: `icons.tsx` keeps every glyph as an array of plain strings and
 * renders them through one `<path>` element, so a data module holding nothing
 * but coordinates — the obvious next refactor — would have carried a complete
 * copy of somebody's drawing past a gate built to catch exactly that. It is
 * detected today only because the renderer that consumes it happens to live in
 * the same file.
 *
 * A quoted moveto followed by two coordinates and something that continues the
 * path is tight enough to keep ordinary prose out: the trailing class is what
 * separates 'M12 3h6' from a sentence that begins with the letter M.
 */
const GLYPH_PATTERN =
  /(<path\b)|(%3Cpath)|(\bd="[Mm][\s\d.,-])|(['"`][Mm]\s?-?\d[\d.]*[\s,]-?\d[\d.]*[\s,a-zA-Z-])/

/**
 * First-party artwork: drawn for this product, owed to nobody. Adding a file
 * here is the deliberate act the gate exists to force — it is the moment a
 * human states "this drawing is ours", in a diff a reviewer reads.
 *
 * `AppShell.tsx` holds the six nav glyphs and `__root.tsx` the search glyph;
 * both are redrawn on the shared 24/1.5/round geometry (Heroicons' magnifying
 * glass starts `m21 21-5.197…`, ours starts `M10.75 4.25a6.5…`) because the
 * entry-chunk purity rule forbids importing the icon module here.
 */
export const FIRST_PARTY_ARTWORK = [
  'src/app/features/nav/AppShell.tsx',
  'src/app/routes/__root.tsx',
]

/**
 * This file, and only this file: it carries GLYPH_PATTERN itself, so it matches
 * its own detector. Kept as a one-entry constant rather than a filter inside
 * the walk so that adding a second exemption is a visible, arguable diff.
 */
export const DETECTOR_SOURCE = 'scripts/notices-check.mjs'

/** True when `text` contains copied-or-drawn SVG path data. */
export function containsGlyphArtwork(text) {
  return GLYPH_PATTERN.test(String(text))
}

/**
 * Files that ship glyph artwork without provenance: neither a notices
 * destination nor declared first-party. Pure so the fail-closed seam is
 * testable without a repository on disk.
 */
export function unattributedGlyphFiles(glyphFiles, noticed, allowlist) {
  const allowed = new Set(allowlist)
  return glyphFiles.filter((file) => !noticed.has(file) && !allowed.has(file))
}

/** Notice rows whose destination is neither in the tree nor a placeholder. */
export function missingNoticeDestinations(destinations, exists) {
  return destinations.filter((dest) => !exists(dest))
}

/** Runs the whole gate against `root`, returning the error list (empty = pass). */
export function runNoticesCheck(root) {
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
      'Copyright 2026 Open Events contributors',
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
    return errors
  }

  const text = readFileSync(noticesPath, 'utf8')
  if (!text.includes(PINNED)) errors.push('pinned donor commit not cited')
  if (!text.includes('Apache-2.0')) errors.push('Apache-2.0 provenance not cited')
  if (!text.includes('MIT')) errors.push('MIT (Heroicons) provenance not cited')
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
  const destinations = []
  for (const [, dest] of rows) {
    if (dest.startsWith('_')) continue
    noticed.add(dest)
    destinations.push(dest)
  }
  for (const dest of missingNoticeDestinations(destinations, (d) => existsSync(resolve(root, d)))) {
    errors.push(`notice destination missing: ${dest}`)
  }

  const marked = []
  const glyphFiles = []
  const inspect = (rel) => {
    const source = readFileSync(resolve(root, rel), 'utf8')
    if (source.includes(MARKER)) marked.push(rel)
    if (rel !== DETECTOR_SOURCE && containsGlyphArtwork(source)) glyphFiles.push(rel)
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (WALKED_EXTENSIONS.test(entry)) inspect(relative(root, path))
    }
  }
  for (const dir of WALKED_DIRECTORIES) {
    const path = resolve(root, dir)
    if (existsSync(path)) walk(path)
  }
  for (const file of WALKED_ROOT_FILES) {
    if (existsSync(resolve(root, file))) inspect(file)
  }

  for (const file of marked) {
    if (!noticed.has(file)) errors.push(`donor-marked file lacks notice row: ${file}`)
  }
  for (const file of unattributedGlyphFiles(glyphFiles, noticed, FIRST_PARTY_ARTWORK)) {
    errors.push(
      `file ships SVG path data with no provenance: ${file} — add a THIRD_PARTY_NOTICES.md row, ` +
        'or declare it first-party in scripts/notices-check.mjs (FIRST_PARTY_ARTWORK)',
    )
  }
  // An allowlist entry that no longer draws anything is a licence claim nobody
  // is checking; it has to be deleted with the artwork it covered.
  const drawing = new Set(glyphFiles)
  for (const file of FIRST_PARTY_ARTWORK) {
    if (!drawing.has(file)) {
      errors.push(`FIRST_PARTY_ARTWORK entry no longer ships path data: ${file}`)
    }
  }

  return errors
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectRun) {
  const errors = runNoticesCheck(resolve(import.meta.dirname, '..'))
  if (errors.length) {
    console.error('notices:check failed:\n' + errors.map((e) => ' - ' + e).join('\n'))
    process.exit(1)
  }
  console.log(
    'notices:check ok — Apache-2.0 LICENSE distributed; donor and glyph provenance complete.',
  )
}
