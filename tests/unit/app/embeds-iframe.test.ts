import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { embedPreviewHref, embedSnippet } from '../../../src/application/services/embeds'
import type { EmbedRecord } from '../../../src/domain/embed'

const EMBED: EmbedRecord = {
  id: 'emb-1',
  eventId: 'evt-1',
  name: 'Sessions list',
  kind: 'sessions',
  format: 'html',
  enabled: true,
  brandColor: '',
  trackFilter: '',
  createdAt: '2026-08-08T12:00:00.000Z',
  updatedAt: '2026-08-08T12:00:00.000Z',
}

describe('embed iframe snippet', () => {
  it('emits a copyable iframe pointed at the public embed route', () => {
    const snippet = embedSnippet('https://openevents.engineer', EMBED)
    expect(snippet).toContain('<iframe')
    expect(snippet).toContain('src="https://openevents.engineer/embed/emb-1"')
    expect(embedPreviewHref('https://openevents.engineer/', 'emb-1')).toBe(
      'https://openevents.engineer/embed/emb-1',
    )
  })

  it('ships a copyable iframe control and a live preview pane on the embeds desk', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../../src/app/features/admin/EmbedsPage.tsx'),
      'utf8',
    )
    expect(source).toContain('data-slot="embed-copy"')
    expect(source).toContain('data-slot="embed-live-preview"')
    expect(source).toContain('Copy iframe')
  })
})
