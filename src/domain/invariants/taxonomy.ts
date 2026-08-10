import type { TaxonomyItem, TaxonomyKind } from '../taxonomy.ts'

export type TaxonomyIssueCode = 'empty_key' | 'duplicate_key' | 'invalid_position'

export interface TaxonomyIssue {
  readonly code: TaxonomyIssueCode
  readonly message: string
}

export function validateTaxonomyItems(items: readonly TaxonomyItem[]): readonly TaxonomyIssue[] {
  const issues: TaxonomyIssue[] = []
  const seenKeys = new Set<string>()
  const positionsByKind = new Map<TaxonomyKind, Set<number>>()
  for (const item of items) {
    if (item.key.trim().length === 0) {
      issues.push({
        code: 'empty_key',
        message: `Taxonomy key for '${item.label}' must not be empty`,
      })
    }
    if (!Number.isInteger(item.position) || item.position < 0) {
      issues.push({
        code: 'invalid_position',
        message: `Taxonomy item '${item.key}' must have a non-negative integer position`,
      })
    }
    const pair = `${item.kind}:${item.key}`
    if (seenKeys.has(pair)) {
      issues.push({
        code: 'duplicate_key',
        message: `Duplicate taxonomy key '${item.key}' for kind '${item.kind}'`,
      })
    }
    seenKeys.add(pair)
    const positions = positionsByKind.get(item.kind) ?? new Set<number>()
    positions.add(item.position)
    positionsByKind.set(item.kind, positions)
  }
  return issues
}
