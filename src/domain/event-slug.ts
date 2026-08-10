/** URL-safe slug from an organizer-typed event name. */
export function slugifyEventName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length === 0 ? 'event' : slug
}

/** First unused slug, appending -2, -3, … when the base is taken. */
export function uniqueEventSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${String(n)}`)) n += 1
  return `${base}-${String(n)}`
}
