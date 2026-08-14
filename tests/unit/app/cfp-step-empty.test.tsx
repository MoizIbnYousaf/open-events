import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ElementRuleDto, FormElementDto, FormPageDto } from '../../../src/application'
import CfpStepRenderer from '../../../src/app/features/public/CfpStepRenderer'

/**
 * One guard, three shapes. A step with nothing under its heading used to be
 * explained only when it had questions AND the wizard had nothing of its own to
 * put on it — so the review and submit steps, which always carry the answer
 * summary, could never reach the explanation however many of their own
 * questions a condition had hidden.
 */

const PAGE: FormPageDto = { id: 'p-1', position: 0, kind: 'info', title: 'Your talk', content: '' }

function question(id: string, fieldKey: string): FormElementDto {
  return {
    id,
    pageId: PAGE.id,
    position: 0,
    kind: 'question',
    fieldKey,
    label: fieldKey,
    required: false,
    maxLength: null,
    questionType: 'short_text',
    options: [],
  }
}

/** Shows `elementId` only when `format` is exactly 'workshop'. */
function showWhenWorkshop(elementId: string): ElementRuleDto {
  return {
    id: `r-${elementId}`,
    elementId,
    effect: 'show',
    groups: [
      {
        groupIndex: 0,
        conditions: [{ operator: 'eq', operandKey: 'format', value: 'workshop' }],
      },
    ],
    position: 0,
  }
}

function renderStep({
  page = PAGE,
  elements = [],
  conditionRules = [],
  children,
}: {
  readonly page?: FormPageDto
  readonly elements?: readonly FormElementDto[]
  readonly conditionRules?: readonly ElementRuleDto[]
  readonly children?: ReactNode
}) {
  return render(
    <CfpStepRenderer
      page={page}
      elements={elements}
      conditionRules={conditionRules}
      answers={{}}
      errors={{}}
      domIds={{}}
      ariaControls={{}}
      registerFieldRef={() => () => undefined}
      onChange={() => undefined}
    >
      {children}
    </CfpStepRenderer>,
  )
}

afterEach(() => {
  cleanup()
})

describe('CFP step with nothing to answer', () => {
  it('explains a step whose questions are all hidden by earlier answers', () => {
    renderStep({
      elements: [question('e-1', 'workshop_details')],
      conditionRules: [showWhenWorkshop('e-1')],
    })

    expect(screen.getByText('Nothing to answer on this step')).toBeInTheDocument()
    expect(
      screen.getByText('Your earlier answers hid every question here. Continue to the next step.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  // RV1-N1: on the submit step there is no next step to continue to. The
  // control under the summary is Submit, and the explanation was pointing the
  // reader at a step that does not exist.
  it('points the last step at its own control instead of promising a next step', () => {
    renderStep({
      page: { ...PAGE, kind: 'submit', title: 'Review and submit' },
      elements: [question('e-1', 'workshop_details')],
      conditionRules: [showWhenWorkshop('e-1')],
      children: <p>Answer summary</p>,
    })

    expect(screen.getByText('Nothing to answer on this step')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your earlier answers hid every question here. Check your answers and submit the proposal.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/continue to the next step/i)).not.toBeInTheDocument()
    expect(screen.getByText('Answer summary')).toBeInTheDocument()
  })

  it('explains a step that carries no questions at all', () => {
    renderStep({})

    expect(screen.getByText('Nothing to answer on this step')).toBeInTheDocument()
    expect(screen.getByText('This step has no questions to fill in.')).toBeInTheDocument()
  })

  it('explains a hidden-out review step and still renders the summary beside it', () => {
    renderStep({
      page: { ...PAGE, kind: 'review', title: 'Review' },
      elements: [question('e-1', 'workshop_details')],
      conditionRules: [showWhenWorkshop('e-1')],
      children: <p>Answer summary</p>,
    })

    expect(screen.getByText('Nothing to answer on this step')).toBeInTheDocument()
    // The wizard's own content renders beside the explanation, not instead of
    // it: the previous guard traded one for the other.
    expect(screen.getByText('Answer summary')).toBeInTheDocument()
  })

  it('leaves a prose step alone — its content is what fills it', () => {
    renderStep({
      page: { ...PAGE, kind: 'welcome', title: 'Welcome', content: 'Read this first.' },
    })

    expect(screen.getByText('Read this first.')).toBeInTheDocument()
    expect(screen.queryByText('Nothing to answer on this step')).not.toBeInTheDocument()
  })

  it('leaves a step whose summary fills it alone', () => {
    renderStep({ children: <p>Answer summary</p> })

    expect(screen.getByText('Answer summary')).toBeInTheDocument()
    expect(screen.queryByText('Nothing to answer on this step')).not.toBeInTheDocument()
  })

  it('says nothing when a visible question is on the step', () => {
    renderStep({ elements: [question('e-1', 'headline')] })

    expect(screen.queryByText('Nothing to answer on this step')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
