import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_FILE_NAME_MAX_LENGTH,
  DOCUMENT_MAX_BYTES,
  documentFileMatchesType,
  documentContentTypeForFile,
  sanitizeDocumentFileName,
} from '../../../src/application'

// O3 P2 policy unit contract: the document allow-list is explicit and the
// display filename is a bounded, sanitized string — never a path. Control
// characters, separators, and over-long names are rejected at the seam that
// every caller must pass through.

describe('document policy constants', () => {
  it('pins the explicit allow-list and bounds', () => {
    expect([...DOCUMENT_CONTENT_TYPES].sort()).toEqual([
      'application/pdf',
      'application/vnd.apple.keynote',
      'application/vnd.ms-powerpoint',
      'application/vnd.oasis.opendocument.presentation',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
    ])
    expect(DOCUMENT_MAX_BYTES).toBe(20 * 1024 * 1024)
    expect(DOCUMENT_FILE_NAME_MAX_LENGTH).toBe(200)
  })

  it('requires the declared type, extension, and container signature to agree', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).buffer
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).buffer
    const text = new TextEncoder().encode('Speaker notes').buffer

    expect(documentFileMatchesType('slides.pdf', 'application/pdf', pdf)).toBe(true)
    expect(
      documentFileMatchesType(
        'slides.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        zip,
      ),
    ).toBe(true)
    expect(documentFileMatchesType('slides.ppt', 'application/vnd.ms-powerpoint', ole)).toBe(true)
    expect(documentFileMatchesType('slides.key', 'application/vnd.apple.keynote', zip)).toBe(true)
    expect(
      documentFileMatchesType('slides.odp', 'application/vnd.oasis.opendocument.presentation', zip),
    ).toBe(true)
    expect(documentFileMatchesType('notes.txt', 'text/plain', text)).toBe(true)

    expect(documentFileMatchesType('slides.pdf', 'application/pdf', zip)).toBe(false)
    expect(documentFileMatchesType('slides.pptx', 'application/pdf', pdf)).toBe(false)
    expect(documentFileMatchesType('slides.exe', 'application/pdf', pdf)).toBe(false)
    expect(documentFileMatchesType('notes.txt', 'text/plain', new Uint8Array([0]).buffer)).toBe(
      false,
    )
  })

  it('infers a safe browser type only from a supported extension', () => {
    expect(documentContentTypeForFile('slides.key', '')).toBe('application/vnd.apple.keynote')
    expect(documentContentTypeForFile('slides.pptx', 'application/octet-stream')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
    expect(documentContentTypeForFile('slides.exe', 'application/pdf')).toBeNull()
    expect(documentContentTypeForFile('slides.pptx', 'application/pdf')).toBeNull()
  })
})

describe('sanitizeDocumentFileName', () => {
  it('accepts a plain trimmed name', () => {
    expect(sanitizeDocumentFileName('  notes v2.pdf ')).toBe('notes v2.pdf')
  })

  it('rejects empty and whitespace-only names', () => {
    expect(sanitizeDocumentFileName('')).toBeNull()
    expect(sanitizeDocumentFileName('   ')).toBeNull()
  })

  it('rejects path separators and traversal', () => {
    expect(sanitizeDocumentFileName('a/b.pdf')).toBeNull()
    expect(sanitizeDocumentFileName('a\\b.pdf')).toBeNull()
    expect(sanitizeDocumentFileName('../../etc/passwd')).toBeNull()
  })

  it('rejects control characters', () => {
    expect(sanitizeDocumentFileName('bad\u0000name.pdf')).toBeNull()
    expect(sanitizeDocumentFileName('bad\u0007name.pdf')).toBeNull()
    expect(sanitizeDocumentFileName('bad\nname.pdf')).toBeNull()
    expect(sanitizeDocumentFileName('bad\tname.pdf')).toBeNull()
  })

  it('rejects names beyond the length bound', () => {
    expect(sanitizeDocumentFileName('x'.repeat(DOCUMENT_FILE_NAME_MAX_LENGTH + 1))).toBeNull()
    expect(sanitizeDocumentFileName('x'.repeat(DOCUMENT_FILE_NAME_MAX_LENGTH))).toBe(
      'x'.repeat(DOCUMENT_FILE_NAME_MAX_LENGTH),
    )
  })
})
