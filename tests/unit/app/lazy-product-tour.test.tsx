import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LazyProductTour from '../../../src/app/features/tour/LazyProductTour'
import { requestTourToggle } from '../../../src/app/features/tour/tour-events'

vi.mock('../../../src/app/features/tour/ProductTour', () => ({
  ProductTour: () => <div role="dialog" aria-label="Loaded product tour" />,
}))

afterEach(() => cleanup())

describe('LazyProductTour', () => {
  it('keeps the feature absent until tour intent and mounts it once intent arrives', async () => {
    render(<LazyProductTour onNavigate={vi.fn()} />)

    expect(screen.queryByRole('dialog', { name: 'Loaded product tour' })).toBeNull()
    requestTourToggle()
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Loaded product tour' })).not.toBeNull(),
    )
  })
})
