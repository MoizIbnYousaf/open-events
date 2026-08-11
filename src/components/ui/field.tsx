import { Field as FieldPrimitive } from '@base-ui/react/field'

import { cn } from '../../lib/utils'

/**
 * One labelled control plus its error message, wired by Base UI rather than by
 * hand. `Field.Root invalid` drives `aria-invalid` on the control and
 * `Field.Error` registers its id into the control's `aria-describedby`, so a
 * surface can never again set `aria-invalid` while leaving the message
 * orphaned — the defect this primitive exists to remove.
 *
 * Validation state is owned by react-hook-form/zod: pass `invalid` explicitly
 * and keep every `<form noValidate>`. Base UI's own validationMode is
 * deliberately not used, so the two never fight over validity.
 */
function Field({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root data-slot="field" className={cn('grid gap-1.5', className)} {...props} />
  )
}

/**
 * Registers a control Base UI does not own — a raw `<input>`, `<textarea>` or
 * `<select>` — with the surrounding Field, so the generated label id, the
 * invalid state and the error id reach it. `src/components/ui/input.tsx`
 * already renders Base UI's Input (which IS a Field.Control), so this is only
 * for the hand-rolled controls.
 */
function FieldControl({ className, ...props }: FieldPrimitive.Control.Props) {
  return <FieldPrimitive.Control data-slot="field-control" className={className} {...props} />
}

/**
 * Label for a labelable control — input, textarea, select, file input.
 *
 * Pass `htmlFor` whenever the control carries an explicit id. Base UI wires the
 * association through context anyway, but a real `for` attribute holds
 * independently of React context and is legible to anything reading the markup.
 */
function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label data-slot="field-label" className={cn('text-sm', className)} {...props} />
  )
}

/**
 * Label for a control that a native `<label for>` cannot target: Base UI's
 * Select renders its trigger as a `<button role="combobox">`. Rendering a
 * `<span>` and letting Base UI generate the id per instance is what removes
 * the duplicate-id class of bug (one hardcoded label id shared by every
 * routing rule made every trigger point at the first rule's label).
 */
function FieldTriggerLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      nativeLabel={false}
      render={<span />}
      className={cn('text-sm font-medium', className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

/**
 * Per-field error text. Deliberately NOT a live region: it is referenced by the
 * control's aria-describedby and every form focuses its first invalid control,
 * so the message is announced with the field. The single `role="alert"` per
 * form stays the submit-level summary (AlertLive).
 */
function FieldError({ className, match = true, ...props }: FieldPrimitive.Error.Props) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      match={match}
      className={cn('text-sm text-destructive', className)}
      {...props}
    />
  )
}

export { Field, FieldControl, FieldLabel, FieldTriggerLabel, FieldDescription, FieldError }
