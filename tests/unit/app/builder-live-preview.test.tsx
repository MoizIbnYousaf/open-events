import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('builder live preview pane', () => {
  it('mounts a two-pane what-speakers-see preview beside the form editor', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../src/app/features/builder/BuilderEditor.tsx'),
      'utf8',
    )
    expect(source).toContain('data-slot="builder-live-preview"')
    expect(source).toContain('What speakers see')
    expect(source).toContain('PreviewEngine')
  })
})
