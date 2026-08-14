import { describe, expect, it } from 'vitest'

// @ts-expect-error — scripts/notices-check.mjs is plain ESM (narrow documented boundary).
import * as gate from '../../../scripts/notices-check.mjs'

const {
  containsGlyphArtwork,
  missingNoticeDestinations,
  unattributedGlyphFiles,
  runNoticesCheck,
  FIRST_PARTY_ARTWORK,
  DETECTOR_SOURCE,
} = gate

/**
 * Provenance-gate contract. The gate that shipped before this file could only
 * prove one direction — a donor-marked file has a row — which is why a
 * Heroicons chevron reached `native-select.tsx` with no notice and a green
 * `notices:check` (R6/L-1). These cases pin the OTHER direction: artwork
 * without provenance fails.
 *
 * Fixtures build their path data by concatenation, the same idiom the gate uses
 * for its own donor marker, so this file does not trip the detector it tests.
 * The split now falls between the moveto's two coordinates as well: the
 * detector reads bare string literals, and a fixture that reads as one complete
 * drawing to the gate is a fixture that fails the gate it is testing.
 */
const D = 'd' + '="'
const OPEN_PATH = '<' + 'path ' + D + 'M4 ' + '4h16" />'
const PATH_ATTRIBUTE = D + 'm19.5 ' + '8.25-7.5 7.5-7.5-7.5"'
const DATA_URI_PATH =
  'url("data:image/svg+xml,%3Csvg%3E%3C' + "path d='m4.5 " + '12.75 6 6\'/%3E%3C/svg%3E")'
/** The form icons.tsx really ships: coordinates in a plain quoted string. */
const BARE_STRING_PATH = "'M2.25 " + "13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512Z'"

describe('glyph detection', () => {
  it('sees a JSX path element', () => {
    expect(containsGlyphArtwork(OPEN_PATH)).toBe(true)
  })

  it('sees a bare d attribute carrying path data', () => {
    expect(containsGlyphArtwork(`<svg ${PATH_ATTRIBUTE} />`)).toBe(true)
  })

  it('sees percent-encoded path data inside a CSS data URI', () => {
    expect(containsGlyphArtwork(`--control-tick: ${DATA_URI_PATH};`)).toBe(true)
  })

  it('does not fire on id="main", the shell contract that looks like path data', () => {
    expect(containsGlyphArtwork('<main id="main" tabIndex={-1}>')).toBe(false)
  })

  it('does not fire on ordinary source', () => {
    expect(containsGlyphArtwork('export const width = 24\n// draws nothing')).toBe(false)
  })

  // V6-GATE: the blind spot. `icons.tsx` keeps every glyph as a plain string
  // and renders them all through a single path element, so a data module holding
  // nothing but coordinates would have carried a complete copy of somebody's
  // drawing past a gate built to catch exactly that.
  it('sees path data carried in a bare string literal', () => {
    expect(containsGlyphArtwork(`export const d = [${BARE_STRING_PATH}]`)).toBe(true)
  })

  it('does not fire on an ordinary sentence that happens to start with M', () => {
    expect(containsGlyphArtwork("const label = 'Monday 12 May'")).toBe(false)
    expect(containsGlyphArtwork("const key = 'M'")).toBe(false)
    expect(containsGlyphArtwork("const size = 'md'")).toBe(false)
  })
})

describe('artwork attribution', () => {
  it('fails a file that ships path data with neither a row nor a first-party claim', () => {
    expect(unattributedGlyphFiles(['src/components/ui/native-select.tsx'], new Set(), [])).toEqual([
      'src/components/ui/native-select.tsx',
    ])
  })

  it('passes once the file has a notices row — the exact shape of the L-1 fix', () => {
    expect(
      unattributedGlyphFiles(
        ['src/components/ui/native-select.tsx'],
        new Set(['src/components/ui/native-select.tsx']),
        [],
      ),
    ).toEqual([])
  })

  it('passes redrawn first-party artwork only when it is named on the allowlist', () => {
    const drawn = ['src/app/features/nav/AppShell.tsx']
    expect(unattributedGlyphFiles(drawn, new Set(), [])).toEqual(drawn)
    expect(unattributedGlyphFiles(drawn, new Set(), drawn)).toEqual([])
  })
})

describe('notice destinations', () => {
  it('reports rows pointing at files that are not in the tree', () => {
    expect(
      missingNoticeDestinations(
        ['src/present.ts', 'src/gone.ts'],
        (dest: string) => dest === 'src/present.ts',
      ),
    ).toEqual(['src/gone.ts'])
  })
})

describe('the live tree', () => {
  it('passes the widened gate', () => {
    expect(runNoticesCheck(process.cwd())).toEqual([])
  })

  it('exempts exactly one file — the detector itself, which quotes its own pattern', () => {
    expect(DETECTOR_SOURCE).toBe('scripts/notices-check.mjs')
  })

  it('claims first-party artwork only for the two entry-chunk surfaces that redraw it', () => {
    expect([...FIRST_PARTY_ARTWORK].sort()).toEqual([
      'src/app/features/nav/AppShell.tsx',
      'src/app/routes/__root.tsx',
    ])
  })
})
