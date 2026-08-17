import { describe, expect, it } from 'vitest'

import {
  validatePortalResourceInput,
  type PortalResourceInput,
} from '../../../src/domain/portal-resource'

describe('portal resource validation', () => {
  it('accepts bounded Markdown and HTTPS link resources', () => {
    expect(
      validatePortalResourceInput({ kind: 'markdown', title: 'Speaker guide', body: '# Hello' }),
    ).toEqual({ kind: 'markdown', title: 'Speaker guide', body: '# Hello', url: null })
    expect(
      validatePortalResourceInput({
        kind: 'link',
        title: 'Venue map',
        url: 'https://example.com/map',
      }),
    ).toEqual({
      kind: 'link',
      title: 'Venue map',
      body: null,
      url: 'https://example.com/map',
    })
  })

  it('rejects blank, mismatched, oversized, and unsafe content', () => {
    expect(() =>
      validatePortalResourceInput({ kind: 'markdown', title: ' ', body: 'Guide' }),
    ).toThrow(/title/i)
    expect(() =>
      validatePortalResourceInput({ kind: 'markdown', title: 'Guide', body: '' }),
    ).toThrow(/body/i)
    expect(() =>
      validatePortalResourceInput({ kind: 'link', title: 'Bad', url: 'javascript:alert(1)' }),
    ).toThrow(/https/i)
    expect(() =>
      validatePortalResourceInput({
        kind: 'link',
        title: 'Bad',
        url: 'https://example.com',
        body: 'x',
      } as unknown as PortalResourceInput),
    ).toThrow(/body/i)
    expect(() =>
      validatePortalResourceInput({ kind: 'markdown', title: 'Guide', body: 'x'.repeat(20_001) }),
    ).toThrow(/20,000/i)
  })
})
