import { Toaster as SonnerToaster, type ToasterProps } from 'sonner'

import { useOptionalTheme } from './theme-provider'

/**
 * Long enough to read a sentence and reach the dismiss control without
 * hurrying. Nothing in this product is reported ONLY by a toast, so the
 * timeout can never be the reason an outcome is missed.
 */
export const TOAST_DURATION_MS = 10_000

/** Three at a time: a taller stack covers the surface the outcome happened on. */
export const MAX_VISIBLE_TOASTS = 3

/**
 * shadcn's Sonner toaster, mounted once in the root shell.
 *
 * ONE LIVE REGION PER OUTCOME: the
 * `<section>` sonner renders is a permanent `aria-live="polite"` region that is
 * in the accessibility tree before any outcome exists — the property this app
 * has always required of a live region — and it carries no ARIA role, so it
 * does not add a second page-global `role="status"` under every surface's own
 * status node. Call sites therefore do NOT also call `announce()`: two regions
 * carrying one sentence speak it twice.
 *
 * Never the only report: every call site keeps the durable on-page record that
 * DEC-011 requires — the completed row, the send history, the version list,
 * the re-read headshot.
 */
export function Toaster(props: ToasterProps) {
  // Optional on purpose: unit tests render a single surface plus this toaster
  // without the app's theme provider, and a toaster that throws there would
  // push every test toward not mounting it at all.
  const theme = useOptionalTheme()

  return (
    <SonnerToaster
      // The resolved scheme, never 'system': the app's stored preference
      // overrides the OS one, and sonner asking the media query itself would
      // light up a dark app.
      theme={theme?.scheme ?? 'system'}
      duration={TOAST_DURATION_MS}
      visibleToasts={MAX_VISIBLE_TOASTS}
      closeButton
      // Stacked cards collapse into a dimmed pile whose text fails WCAG
      // contrast (axe: serious); the expanded stack keeps every visible
      // notification fully readable.
      expand
      // Sonner reads this label once, for every card — it has no per-toast
      // equivalent. "Dismiss notification" rather than sonner's "Close toast":
      // a stack of three otherwise offers three buttons whose names say
      // nothing about what is being closed, and the card's own text is the
      // only thing that tells them apart.
      toastOptions={{ closeButtonAriaLabel: 'Dismiss notification' }}
      // The app's own tokens rather than sonner's palette, so a card matches
      // the popovers and dialogs it appears over in either scheme.
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
