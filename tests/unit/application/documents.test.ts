import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_FILE_NAME_MAX_LENGTH,
  DOCUMENT_MAX_BYTES,
  sanitizeDocumentFileName,
} from '../../../src/application'

// O3 P2 policy unit contract: the document allow-list is explicit and the
// display filename is a bounded, sanitized string — never a path. Control
// characters, separators, and over-long names are rejected at the seam that
// every caller must pass through.

describe('document policy constants', () => {
  it('pins the explicit allow-list and bounds', () => {
    expect([...DOCUMENT_CONTENT_TYPES].sort()).toEqual(['application/pdf', 'text/plain'])
    expect(DOCUMENT_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(DOCUMENT_FILE_NAME_MAX_LENGTH).toBe(200)
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
