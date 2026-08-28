import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubmissionFacetFilters } from '../../../src/app/features/admin/SubmissionFacetFilters'

const FACETS = [
  {
    elementId: 'element-format',
    versionId: 'version-1',
    formId: 'form-1',
    formSlug: 'cfp',
    fieldKey: 'format',
    label: 'Session format',
    questionType: 'single_choice' as const,
    options: [
      { value: 'Talk', count: 2 },
      { value: 'Workshop', count: 1 },
    ],
  },
]

afterEach(cleanup)

describe('SubmissionFacetFilters', () => {
  it('clears the selected answer filters explicitly', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SubmissionFacetFilters
        facets={FACETS}
        selections={[{ elementId: 'element-format', values: ['Talk'] }]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByText('Answer filters (1)'))
    await user.click(await screen.findByRole('button', { name: 'Clear answer filters' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('adds a bounded choice through the nested filter menu', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SubmissionFacetFilters facets={FACETS} selections={[]} onChange={onChange} />)

    await user.click(screen.getByText('Answer filters'))
    const talk = await screen.findByRole('checkbox', { name: /Talk.*2/i })
    await user.click(talk)
    expect(onChange).toHaveBeenCalledWith([{ elementId: 'element-format', values: ['Talk'] }])
  })
})
