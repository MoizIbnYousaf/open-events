/**
 * Linear-style desk selection: a deep-linkable `?spotlight=` id and j/k
 * movement along an ordered list. Pure so the desks and the tests share one
 * implementation.
 */

export function parseSpotlightSearch(search: string): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search
  const value = new URLSearchParams(query).get('spotlight')
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function writeSpotlightSearch(search: string, id: string | null): string {
  const query = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(query)
  if (id === null || id.trim() === '') params.delete('spotlight')
  else params.set('spotlight', id)
  const next = params.toString()
  return next.length === 0 ? '' : `?${next}`
}

export function nextSpotlightId(
  ids: readonly string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (ids.length === 0) return null
  const index = current === null ? -1 : ids.indexOf(current)
  if (index === -1) return delta === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null)
  const next = index + delta
  if (next < 0 || next >= ids.length) return ids[index] ?? null
  return ids[next] ?? null
}

export function shouldIgnoreSpotlightKey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
