import type { ElementRuleDto, FormElementDto, FormPageDto } from '../../../application'
import type { AnswerMap, ElementFieldKey } from '../../../domain'
import { isElementVisibleDto } from '../../lib/form-engine'
import { AlertLive } from '../../../components/ui/alert-live'
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
}: CfpStepRendererProps) {
  const visibleElements = elements.filter(
    (element): element is FormElementDto & { fieldKey: ElementFieldKey } =>
      element.fieldKey !== null && isElementVisibleDto(element, conditionRules, answers),
  )
  return (
    <section className="grid gap-4">
      <h2 className="text-xl font-semibold">{page.title}</h2>
      {page.content.length > 0 ? (
        <p className="text-sm text-muted-foreground">{page.content}</p>
      ) : null}
      {Object.keys(errors).length > 0 ? (
        <AlertLive>Please fix the highlighted fields.</AlertLive>
      ) : null}
      <div className="grid gap-4">
        {visibleElements.map((element) => (
          <CfpFields
            key={element.id}
            element={element}
            domId={domIds[element.fieldKey] ?? `cfp-${page.position}`}
            value={answers[element.fieldKey]}
            error={errors[element.fieldKey]}
            ariaControls={ariaControls[element.fieldKey]}
            inputRef={registerFieldRef(element.fieldKey)}
            onChange={(value) => onChange(element.fieldKey, value)}
          />
        ))}
      </div>
    </section>
  )
}
