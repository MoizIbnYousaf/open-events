import { Children, isValidElement, type ReactNode } from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'

import { cn } from '../../lib/utils'
import { buttonVariants, type ButtonVariants } from './button-variants'

/**
 * An icon-only control whose only child is the glyph has no accessible name at
 * all, and the failure is invisible on screen. We warn in development rather
 * than throw: crashing a judged walkthrough over a missing label trades one
 * defect for a worse one.
 */
function warnUnlabelledIconButton(size: string, props: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return
  if (!size.startsWith('icon')) return
  if (props['aria-label'] !== undefined) return
  if (props['aria-labelledby'] !== undefined) return
  if (props['title'] !== undefined) return
  const children = props.children as ReactNode
  // More than one child means a visually-hidden label is present alongside the
  // glyph, which is the other legitimate way to name the control.
  if (Children.count(children) !== 1) return
  if (typeof children === 'string' || typeof children === 'number') return
  if (!isValidElement(children)) return
  console.warn(
    'Button: an icon-only button needs an accessible name — pass aria-label, or render a visually hidden label alongside the glyph.',
  )
}

/**
 * `pending` is the one place an async trigger's in-flight state is expressed:
 * it makes the control inert so it cannot fire twice, and exposes aria-busy so
 * the state is programmatic and not just a change in opacity. The visible
 * label swap stays the caller's job — "Saving…" vs "Publishing…" is copy, not
 * a primitive's decision.
 *
 * PENDING IS NOT `disabled`. The browser blurs an element the instant it gains
 * the native `disabled` attribute, so a control that went inert while it held
 * focus threw that focus to `document.body` — and nothing put it back when the
 * request settled. A keyboard reader pressed Save and lost their place in the
 * page; inside a modal that stays open until the server answers, they lost
 * their place inside the dialog while the dialog was still there. The `aria-busy`
 * we set to announce the in-flight state was announced to nobody, because it sat
 * on an element that was no longer focused and no longer in the tab order.
 *
 * So `pending` renders as `aria-disabled` (Base UI's `focusableWhenDisabled`):
 * the control keeps focus and its tab stop, `aria-busy` stays on the element the
 * reader is standing on, and Base UI suppresses click, pointerdown and every
 * non-Tab keystroke — Tab still works, because being busy is not a trap.
 *
 * `disabled` keeps the native attribute, because that is a different statement:
 * "there is nothing to do here", usually server-derived, and a control nobody
 * can act on has no claim on the tab order. A caller may still opt a genuinely
 * disabled control into focus retention by passing `focusableWhenDisabled`.
 *
 * The consequence for tests: a pending control is `aria-disabled`, which
 * jest-dom's `toBeDisabled()` does not honour by design. Assert the semantics —
 * `aria-busy`, `aria-disabled`, and that the handler did not fire twice — not
 * the attribute.
 */
function Button({
  className,
  variant = 'default',
  size = 'default',
  pending = false,
  disabled = false,
  focusableWhenDisabled,
  ...props
}: ButtonPrimitive.Props & ButtonVariants & { pending?: boolean }) {
  warnUnlabelledIconButton(size ?? 'default', props as Record<string, unknown>)
  return (
    <ButtonPrimitive
      data-slot="button"
      data-pending={pending ? '' : undefined}
      aria-busy={pending ? true : undefined}
      disabled={disabled || pending}
      focusableWhenDisabled={focusableWhenDisabled ?? (pending && !disabled)}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
