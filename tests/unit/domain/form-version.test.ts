import { describe, expect, it } from 'vitest'

import {
  VERSION_STATUSES,
  canonicalizeFormVersionContent,
  canEditVersion,
  computeFormVersionContentHash,
  isFormPublished,
  isVersionFrozen,
  nextVersionNumber,
  validatePublishedVersionBinding,
  validateVersionFreeze,
} from '../../../src/domain'
import {
  createContent,
  createElement,
  createForm,
  createVersion,
  formatElement,
} from '../helpers/fixtures'
import { installNodeWebCrypto } from '../helpers/stub-webcrypto'

installNodeWebCrypto()

describe('form version numbering', () => {
  it('numbers versions starting at 1', () => {
    expect(nextVersionNumber([])).toBe(1)
  })

  it('advances beyond the highest existing version regardless of status', () => {
    const versions = [
      createVersion({ version: 1, status: 'published' }),
      createVersion({ id: 'version-2', version: 2, status: 'draft' }),
    ]
    expect(nextVersionNumber(versions)).toBe(3)
  })
})

describe('version freeze invariants', () => {
  it('defines only draft and published statuses', () => {
    expect(VERSION_STATUSES).toEqual(['draft', 'published'])
  })

  it('treats only published versions as frozen', () => {
    expect(isVersionFrozen(createVersion({ status: 'published' }))).toBe(true)
    expect(isVersionFrozen(createVersion({ status: 'draft' }))).toBe(false)
    expect(canEditVersion(createVersion({ status: 'draft' }))).toBe(true)
    expect(canEditVersion(createVersion({ status: 'published' }))).toBe(false)
  })

  it('accepts a clean draft and a complete published version', () => {
    const draft = createVersion({ status: 'draft', contentHash: null, publishedAt: null })
    const published = createVersion({
      status: 'published',
      contentHash: 'hash',
      publishedAt: '2026-05-01T00:00:00.000Z',
    })

    expect(validateVersionFreeze(draft)).toEqual([])
    expect(validateVersionFreeze(published)).toEqual([])
  })

  it('rejects a published version without a content hash', () => {
    const issues = validateVersionFreeze(
      createVersion({ status: 'published', contentHash: null, publishedAt: NOW_PUBLISHED }),
    )

    expect(issues.map((issue) => issue.code)).toContain('published_without_hash')
  })

  it('rejects a published version without a publish instant', () => {
    const issues = validateVersionFreeze(
      createVersion({ status: 'published', contentHash: 'hash', publishedAt: null }),
    )

    expect(issues.map((issue) => issue.code)).toContain('published_without_date')
  })

  it('rejects a draft version that carries a publish instant', () => {
    const issues = validateVersionFreeze(
      createVersion({ status: 'draft', publishedAt: NOW_PUBLISHED }),
    )

    expect(issues.map((issue) => issue.code)).toContain('draft_with_published_at')
  })

  it('rejects non-positive and non-integer version numbers', () => {
    const zero = validateVersionFreeze(createVersion({ version: 0 }))
    const fractional = validateVersionFreeze(createVersion({ version: 1.5 }))

    expect(zero.map((issue) => issue.code)).toContain('version_number')
    expect(fractional.map((issue) => issue.code)).toContain('version_number')
  })

  it('accepts a form bound to its own published version', () => {
    const version = createVersion({
      id: 'version-published',
      status: 'published',
      contentHash: 'hash',
      publishedAt: NOW_PUBLISHED,
    })
    const form = createForm({
      status: 'published',
      publishedVersionId: version.id,
    })

    expect(isFormPublished(form)).toBe(true)
    expect(validatePublishedVersionBinding(form, version)).toEqual([])
  })

  it('rejects a published binding that points elsewhere or at a draft', () => {
    const version = createVersion({ id: 'version-published', status: 'published' })
    const form = createForm({ status: 'published', publishedVersionId: 'version-other' })
    const draft = createVersion({ id: 'version-draft', status: 'draft' })
    const unboundForm = createForm({ status: 'draft', publishedVersionId: null })

    expect(validatePublishedVersionBinding(form, version).map((issue) => issue.code)).toContain(
      'published_version_mismatch',
    )
    expect(
      validatePublishedVersionBinding(createForm({ status: 'published' }), draft).map(
        (issue) => issue.code,
      ),
    ).toContain('published_version_mismatch')
    expect(
      validatePublishedVersionBinding(unboundForm, createVersion({ status: 'published' })).map(
        (issue) => issue.code,
      ),
    ).toContain('published_version_mismatch')
  })
})

describe('content-hash canonicalization', () => {
  it('is stable across array ordering when positions are explicit', () => {
    const content = createContent()
    const shuffled = createContent({
      pages: [...content.pages].reverse(),
      elements: [...content.elements].reverse(),
      conditionRules: [...content.conditionRules].reverse(),
      routingRules: [...content.routingRules].reverse(),
    })

    expect(canonicalizeFormVersionContent(content)).toBe(canonicalizeFormVersionContent(shuffled))
  })

  it('changes when element content changes', () => {
    const content = createContent()
    const changed = createContent({
      elements: [
        createElement({ ...formatElement, label: 'Renamed' }),
        ...content.elements.slice(1),
      ],
    })

    expect(canonicalizeFormVersionContent(content)).not.toBe(
      canonicalizeFormVersionContent(changed),
    )
  })

  it('computes a stable 64-char hex hash for identical content', async () => {
    const content = createContent()
    const first = await computeFormVersionContentHash(content)
    const second = await computeFormVersionContentHash(createContent({ ...content }))

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(second)
  })

  it('computes different hashes for different content', async () => {
    const content = createContent()
    const changed = createContent({
      routingRules: [],
    })

    expect(await computeFormVersionContentHash(content)).not.toBe(
      await computeFormVersionContentHash(changed),
    )
  })
})

const NOW_PUBLISHED = '2026-05-01T00:00:00.000Z'
