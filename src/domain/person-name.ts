const PARTICLES = new Set([
  'van',
  'von',
  'de',
  'der',
  'den',
  'da',
  'di',
  'du',
  'la',
  'le',
  'del',
  'della',
  'dos',
  'das',
  'st',
  'st.',
])

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'phd', 'md'])

export interface SplitDisplayName {
  readonly given: string
  readonly surname: string
}

/**
 * Best-effort split of a single free-text `contacts.name`. Comma form wins
 * ("Raman, Priya"). Otherwise walk backwards over generational suffixes and
 * particles. Mononyms sort under the whole name.
 *
 * This is wrong for surname-first cultures and unhyphenated double surnames.
 * It is the honest current behaviour, not a claim that the name is parsed.
 */
export function splitDisplayName(name: string): SplitDisplayName {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { given: '', surname: '' }
  const comma = trimmed.indexOf(',')
  if (comma >= 0) {
    return {
      surname: trimmed.slice(0, comma).trim(),
      given: trimmed.slice(comma + 1).trim(),
    }
  }
  const parts = trimmed.split(/\s+/).filter((part) => part.length > 0)
  if (parts.length === 1) return { given: '', surname: trimmed }
  let end = parts.length - 1
  while (end > 0 && SUFFIXES.has(parts[end]!.toLowerCase())) end -= 1
  let start = end
  while (start > 0 && PARTICLES.has(parts[start - 1]!.toLowerCase())) start -= 1
  return {
    given: parts.slice(0, start).join(' '),
    surname: parts.slice(start).join(' '),
  }
}

export function surnameSortKey(name: string): string {
  return splitDisplayName(name).surname.toLocaleLowerCase('en')
}

/** True when a stored "name" is actually an email and must stay off the public wire. */
export function looksLikeEmail(value: string): boolean {
  return value.includes('@')
}
