import { describe, expect, it } from 'vitest'

import { selectFilesForLatestZip, zipEntryFileName } from '../../../src/application/zip-latest'

describe('selectFilesForLatestZip', () => {
  const files = [
    { id: 'd1', kind: 'document', ownerContactId: 'c-1', fileName: 'slides.pdf' },
    { id: 'h1', kind: 'headshot', ownerContactId: 'c-1', fileName: null },
    { id: 'd2', kind: 'document', ownerContactId: 'c-2', fileName: 'notes.txt' },
  ]

  it('includes headshots as well as documents', () => {
    expect(selectFilesForLatestZip(files, ['c-1']).map((file) => file.id)).toEqual(['d1', 'h1'])
  })

  it('names a headshot when the stored file name is null', () => {
    expect(zipEntryFileName(files[1]!)).toBe('headshot')
  })
})
