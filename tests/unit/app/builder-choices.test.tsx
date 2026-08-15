import { useState } from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import type { FormElement } from '../../../src/domain'
import ElementEditor from '../../../src/app/features/builder/ElementEditor'
import {
  choicesTextToOptions,
  compactChoiceOptions,
} from '../../../src/app/features/builder/builder-model'

const BASE: FormElement = {
  id: 'e-choice',
  eventId: 'event-1',
  versionId: 'version-1',
  pageId: 'page-1',
  position: 0,
  kind: 'question',
  fieldKey: 'audience',
  label: 'Audience level',
  required: false,
  maxLength: 200,
  questionType: 'single_choice',
  options: [],
  optionsSource: null,
}

function ChoicesEditor({ onCommit }: { readonly onCommit?: (options: readonly string[]) => void }) {
  const [element, setElement] = useState<FormElement>(BASE)
  return (
    <ElementEditor
      element={element}
      onUpdate={(patch) => {
        setElement((current) => ({ ...current, ...patch }))
        if (patch.options !== undefined) onCommit?.(patch.options)
      }}
    />
  )
}

afterEach(() => {
  cleanup()
})

describe('ElementEditor dropdown choices', () => {
  it('types spaces, Enter, and a blank line as raw text, then compacts on blur', async () => {
    const user = userEvent.setup()
    const committed: string[][] = []
    render(<ChoicesEditor onCommit={(options) => committed.push([...options])} />)
    const field = screen.getByLabelText(/choices \(one per line\)/i)

    // "Option 1" is a mid-line space; "Option 2 " is a trailing space;
    // the last Enter leaves a blank line.
    await user.type(field, 'Option 1{Enter}Option 2 {Enter}')
    expect(field).toHaveValue('Option 1\nOption 2 \n')
    expect(committed).toEqual([])

    await user.tab()
    expect(committed).toEqual([['Option 1', 'Option 2 ', '']])
    expect(compactChoiceOptions(committed[0] ?? [])).toEqual(['Option 1', 'Option 2'])
  })

  it('splits on newlines only; compactChoiceOptions is the save normalizer', () => {
    expect(choicesTextToOptions('Option 1\nOption 2 \n')).toEqual(['Option 1', 'Option 2 ', ''])
    expect(compactChoiceOptions(['Option 1', 'Option 2 ', ''])).toEqual(['Option 1', 'Option 2'])
  })
})
