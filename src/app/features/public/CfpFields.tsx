import type { FormElementDto } from '../../../application'
import type { AnswerValue } from '../../../domain'

interface CfpFieldsProps {
  readonly element: FormElementDto
  readonly domId: string
  readonly value: AnswerValue | null | undefined
  readonly error?: string
  readonly ariaControls?: string
  readonly inputRef?: (node: HTMLElement | null) => void
  readonly onChange: (value: AnswerValue) => void
}

export default function CfpFields({
  element,
  domId,
  value,
  error,
  ariaControls,
  inputRef,
  onChange,
}: CfpFieldsProps) {
  const label = element.label ?? 'Question'
  const errorId = `${domId}-error`
  const stringValue = typeof value === 'string' ? value : ''
  const maxLength = element.maxLength ?? undefined
  const baseClass =
    'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none disabled:opacity-50 md:text-sm'
  const invalidProps = {
    'aria-invalid': error !== undefined ? true : undefined,
    'aria-describedby': error !== undefined ? errorId : undefined,
    'aria-controls': ariaControls,
  }
  const errorNode =
    error !== undefined ? (
      <p id={errorId} className="text-sm text-destructive">
        {error}
      </p>
    ) : null

  if (element.questionType === 'long_text') {
    return (
      <div className="grid gap-1.5">
        <label htmlFor={domId}>{label}</label>
        <textarea
          id={domId}
          ref={inputRef}
          value={stringValue}
          maxLength={maxLength}
          {...invalidProps}
          onChange={(event) => onChange(event.target.value)}
          className={`${baseClass} min-h-24 resize-y`}
        />
        {errorNode}
      </div>
    )
  }
  if (element.questionType === 'single_choice') {
    return (
      <div className="grid gap-1.5">
        <label htmlFor={domId}>{label}</label>
        <select
          id={domId}
          ref={inputRef as (node: HTMLSelectElement | null) => void}
          value={stringValue}
          {...invalidProps}
          onChange={(event) => onChange(event.target.value)}
          className={baseClass}
        >
          <option value="">Select…</option>
          {element.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {errorNode}
      </div>
    )
  }
  if (element.questionType === 'multi_choice') {
    const selected = Array.isArray(value) ? (value as readonly string[]) : []
    return (
      <fieldset id={domId} {...invalidProps} className="grid gap-1.5">
        <legend className="text-sm font-medium">{label}</legend>
        {element.options.map((option, index) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              ref={index === 0 ? inputRef : undefined}
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option),
                )
              }
            />
            {option}
          </label>
        ))}
        {errorNode}
      </fieldset>
    )
  }
  const inputType =
    element.questionType === 'number'
      ? 'number'
      : element.questionType === 'email'
        ? 'email'
        : 'text'
  return (
    <div className="grid gap-1.5">
      <label htmlFor={domId}>{label}</label>
      <input
        id={domId}
        ref={inputRef}
        type={inputType}
        value={stringValue}
        maxLength={maxLength}
        {...invalidProps}
        onChange={(event) =>
          onChange(
            inputType === 'number' && event.target.value !== ''
              ? Number(event.target.value)
              : event.target.value,
          )
        }
        className={baseClass}
      />
      {errorNode}
    </div>
  )
}
