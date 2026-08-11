import type { ReactNode } from 'react'

import type { ElementRuleDto, FormElementDto, FormPageDto } from '../../../application'
import type { AnswerMap, ElementFieldKey } from '../../../domain'
import { isElementRequiredDto, isElementVisibleDto } from '../../lib/form-engine'
import { AlertLive } from '../../../components/ui/alert-live'
import { EmptyState } from '../../../components/ui/empty-state'
import { InboxIcon } from '../../../components/ui/icons'
import { SectionHeading } from '../../../components/ui/section-heading'
import CfpFields from './CfpFields'

interface CfpStepRendererProps {
  readonly page: FormPageDto
  readonly elements: readonly FormElementDto[]
  readonly conditionRules: readonly ElementRuleDto[]
  readonly answers: AnswerMap
  readonly errors: Readonly<Record<string, string | undefined>>
  readonly domIds: Readonly<Record<string, string>>
  readonly ariaControls: Readonly<Record<string, string | undefined>>
  readonly registerFieldRef: (fieldKey: ElementFieldKey) => (node: HTMLElement | null) => void
  readonly onChange: (fieldKey: ElementFieldKey, value: unknown) => void
  /**
   * Step content the wizard owns rather than the form definition: the built-in
   * proposal-title field on the proposal step, the answer summary on the final
   * one. It renders after the heading and before the form's own questions,
   * because a heading that arrives in the middle of its own section introduces
   * nothing.
   */
  readonly children?: ReactNode
}

export default function CfpStepRenderer({
  page,
  elements,
  conditionRules,
  answers,
  errors,
  domIds,
  ariaControls,
  registerFieldRef,
  onChange,
  children,
}: CfpStepRendererProps) {
  const visibleElements = elements.filter(
    (element): element is FormElementDto & { fieldKey: ElementFieldKey } =>
      element.fieldKey !== null && isElementVisibleDto(element, conditionRules, answers),
  )
  // ONE guard for every shape of "there is nothing to answer here".
  //
  // The previous one also required `children === undefined`, which tied the
  // question of whether a step has anything to answer to whether the WIZARD
  // had something of its own to put on it. The review and submit steps always
  // pass the answer summary, so no matter how many of their own questions a
  // condition hid, they could never reach the explanation. The step's own
  // visible questions decide it now, and the wizard's content renders either
  // way — beside the explanation rather than instead of it.
  const noQuestions = visibleElements.length === 0
  const hiddenByConditions = noQuestions && elements.length > 0
  // A step published with no questions at all is only empty when nothing else
  // fills it: a welcome page's prose and the review summary are its content,
  // and a dashed box under either would be inventing a problem.
  const emptyStep =
    noQuestions && elements.length === 0 && children === undefined && page.content.length === 0
  const nothingToAnswer = hiddenByConditions || emptyStep
  // The way forward depends on where the reader is standing. On the submit
  // step there is no next step to continue to — the control below the summary
  // is Submit — and the explanation was sending them somewhere that does not
  // exist.
  const hiddenByConditionsMessage =
    page.kind === 'submit'
      ? 'Your earlier answers hid every question here. Check your answers and submit the proposal.'
      : 'Your earlier answers hid every question here. Continue to the next step.'
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <SectionHeading>{page.title}</SectionHeading>
        {page.content.length > 0 ? (
          <p className="text-sm text-muted-foreground">{page.content}</p>
        ) : null}
      </div>
      {Object.keys(errors).length > 0 ? (
        <AlertLive>Please fix the highlighted fields.</AlertLive>
      ) : null}
      <div className="grid gap-4">
        {children}
        {nothingToAnswer ? (
          <EmptyState
            icon={<InboxIcon size={20} />}
            title="Nothing to answer on this step"
            description={
              hiddenByConditions
                ? hiddenByConditionsMessage
                : 'This step has no questions to fill in.'
            }
          />
        ) : (
          visibleElements.map((element) => (
            <CfpFields
              key={element.id}
              element={element}
              domId={domIds[element.fieldKey] ?? `cfp-${page.position}`}
              value={answers[element.fieldKey]}
              required={isElementRequiredDto(element, conditionRules, answers)}
              error={errors[element.fieldKey]}
              ariaControls={ariaControls[element.fieldKey]}
              inputRef={registerFieldRef(element.fieldKey)}
              onChange={(value) => onChange(element.fieldKey, value)}
            />
          ))
        )}
      </div>
    </section>
  )
}
