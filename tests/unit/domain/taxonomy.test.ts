import { describe, expect, it } from 'vitest'

import { TAXONOMY_KINDS, validateTaxonomyItems } from '../../../src/domain'
import { createTaxonomyItem } from '../helpers/fixtures'

function issueCodes(items: Parameters<typeof validateTaxonomyItems>[0]): readonly string[] {
  return validateTaxonomyItems(items).map((issue) => issue.code)
}

describe('taxonomy invariants', () => {
  it('defines the canonical vocabulary kinds', () => {
    expect(TAXONOMY_KINDS).toEqual(['format', 'track', 'room', 'level', 'language', 'tag'])
  })

  it('accepts a clean, distinct item set', () => {
    const items = [
      createTaxonomyItem(),
      createTaxonomyItem({
        id: 'tax-talk',
        kind: 'format',
        key: 'talk',
        label: 'Talk',
        position: 1,
      }),
    ]

    expect(validateTaxonomyItems(items)).toEqual([])
  })

  it('rejects empty and whitespace-only keys', () => {
    expect(issueCodes([createTaxonomyItem({ key: '' })])).toContain('empty_key')
    expect(issueCodes([createTaxonomyItem({ key: '   ' })])).toContain('empty_key')
  })

  it('rejects duplicate keys within one kind but allows reuse across kinds', () => {
    const duplicates = [
      createTaxonomyItem(),
      createTaxonomyItem({ id: 'tax-workshop-2', key: 'workshop' }),
    ]
    const crossKind = [
      createTaxonomyItem(),
      createTaxonomyItem({ id: 'tax-workshop-format', kind: 'format', key: 'workshop' }),
    ]

    expect(issueCodes(duplicates)).toContain('duplicate_key')
    expect(validateTaxonomyItems(crossKind)).toEqual([])
  })

  it('rejects negative and non-integer positions', () => {
    expect(issueCodes([createTaxonomyItem({ position: -1 })])).toContain('invalid_position')
    expect(issueCodes([createTaxonomyItem({ position: 1.5 })])).toContain('invalid_position')
  })
})
