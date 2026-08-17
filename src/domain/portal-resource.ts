import type { EventId, UtcInstant } from './event'

export const PORTAL_RESOURCE_KINDS = ['markdown', 'link'] as const
export type PortalResourceKind = (typeof PORTAL_RESOURCE_KINDS)[number]

export interface PortalResource {
  readonly id: string
  readonly eventId: EventId
  readonly kind: PortalResourceKind
  readonly title: string
  readonly body: string | null
  readonly url: string | null
  readonly position: number
  readonly published: boolean
  readonly createdAt: UtcInstant
  readonly updatedAt: UtcInstant
}

export type PortalResourceInput =
  | {
      readonly kind: 'markdown'
      readonly title: string
      readonly body: string
      readonly url?: never
    }
  | { readonly kind: 'link'; readonly title: string; readonly url: string; readonly body?: never }

export interface ValidatedPortalResourceInput {
  readonly kind: PortalResourceKind
  readonly title: string
  readonly body: string | null
  readonly url: string | null
}

export function validatePortalResourceInput(
  input: PortalResourceInput,
): ValidatedPortalResourceInput {
  const title = input.title.trim()
  if (title.length === 0 || title.length > 120) {
    throw new Error('Resource title must be between 1 and 120 characters')
  }
  if (input.kind === 'markdown') {
    if ('url' in input && input.url !== undefined)
      throw new Error('Markdown resource cannot have a URL')
    const body = input.body.trim()
    if (body.length === 0) throw new Error('Markdown resource body is required')
    if (body.length > 20_000)
      throw new Error('Markdown resource body is limited to 20,000 characters')
    return { kind: input.kind, title, body, url: null }
  }
  if ('body' in input && input.body !== undefined)
    throw new Error('Link resource cannot have a body')
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    throw new Error('Resource link must be a valid HTTPS or mailto URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'mailto:') {
    throw new Error('Resource link must use HTTPS or mailto')
  }
  if (input.url.length > 2_048) throw new Error('Resource link is too long')
  return { kind: input.kind, title, body: null, url: input.url }
}
