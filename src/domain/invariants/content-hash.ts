import type { AnswerMap } from '../answers.ts'
import type { VersionId } from '../form-version.ts'
import type { FormVersionContent } from '../form-version.ts'

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function byPosition<T extends { readonly position: number; readonly id: string }>(
  a: T,
  b: T,
): number {
  return a.position - b.position || a.id.localeCompare(b.id)
}

/**
 * Deterministic canonical serialization of a form version's content: arrays
 * are ordered by position (id as tiebreaker) and object keys are sorted, so
 * identical content always produces an identical string.
 */
export function canonicalizeFormVersionContent(content: FormVersionContent): string {
  const pages = [...content.pages].sort(byPosition)
  const elements = [...content.elements].sort(
    (a, b) => a.pageId.localeCompare(b.pageId) || byPosition(a, b),
  )
  const conditionRules = [...content.conditionRules].sort(byPosition)
  const routingRules = [...content.routingRules].sort(byPosition)
  return stableStringify({ pages, elements, conditionRules, routingRules })
}

/** SHA-256 (hex) over the canonical serialization; computed at publish time. */
export async function computeFormVersionContentHash(content: FormVersionContent): Promise<string> {
  return hashCanonical(canonicalizeFormVersionContent(content))
}

/** SHA-256 (hex) over the immutable submission snapshot (title + answers). */
export async function computeSubmissionContentHash(
  title: string,
  answers: AnswerMap,
  formVersionId: VersionId,
): Promise<string> {
  return hashCanonical(stableStringify({ title, answers, formVersionId }))
}

async function hashCanonical(canonical: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
