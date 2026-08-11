import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Toaster } from '../../../src/components/ui/sonner'

// O4 regression: the toast stack must stay accessible. Collapsed stacked
// cards dim their text below WCAG contrast (axe: serious, caught by the
// golden journey), so the stack renders expanded with the app's popover tokens.

afterEach(cleanup)

describe('toaster accessibility configuration', () => {
  it('pins the expanded stack and app-token colors', async () => {
    render(<Toaster />)
    const { toast } = await import('sonner')
    toast.success('Contrast pin')
    const region = await new Promise<Element | null>((resolve) => {
      let attempts = 0
      const poll = () => {
        const found = document.querySelector('[data-sonner-toaster]')
        if (found !== null || attempts > 40) return resolve(found)
        attempts += 1
        setTimeout(poll, 25)
      }
      poll()
    })
    expect(region).not.toBeNull()
    const style = region?.getAttribute('style') ?? ''
    expect(style).toContain('--normal-bg: var(--popover)')
    expect(style).toContain('--normal-text: var(--popover-foreground)')
    // The stack renders expanded so no visible card is dimmed below contrast.
    expect(region?.getAttribute('data-y-position')).not.toBeNull()
    const toaster = document.querySelector('[data-sonner-toaster]')
    expect(toaster?.outerHTML).toContain('data-expanded="true"')
  })
})
