import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'

import { Button } from '../../../components/ui/button'
import { StatusLive } from '../../../components/ui/status-live'
import { isEditableTarget } from '../../lib/editable-target'
import { TOUR_STEPS } from './tour-steps'

/**
 * Fired on `window` to toggle the tour from a visible control (the header
 * button). Same additive-door pattern as the command menu's open event.
 */
export const TOUR_TOGGLE_EVENT = 'speakerops:tour-toggle'

/** Set when the tour is finished or skipped. The tour NEVER auto-opens. */
const TOUR_DONE_KEY = 'speakerops:tour-done'

/** How long a step waits for its [data-tour] hook before rendering centered. */
const TARGET_POLL_MS = 2000
const POPOVER_WIDTH = 320
const POPOVER_HEIGHT_ESTIMATE = 220
const VIEWPORT_MARGIN = 8
const SPOTLIGHT_PAD = 4

interface TargetRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/** Substitute `$param` segments so a route can be compared to a pathname. */
function concretePath(route: string, params?: Readonly<Record<string, string>>): string {
  return route.replace(/\$([A-Za-z0-9_]+)/g, (segment, name: string) => params?.[name] ?? segment)
}

function measure(element: Element): TargetRect | null {
  const rect = element.getBoundingClientRect()
  // A zero-size rect means the hook exists but has no layout (hidden, or a
  // layoutless test DOM); treat it as missing and fall back to centered.
  if (rect.width <= 0 || rect.height <= 0) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function findTarget(target: string | undefined): TargetRect | null {
  if (target === undefined) return null
  const element = document.querySelector(`[data-tour="${target}"]`)
  return element === null ? null : measure(element)
}

function popoverStyle(rect: TargetRect | null): CSSProperties {
  if (rect === null) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: POPOVER_WIDTH,
      maxWidth: 'calc(100vw - 16px)',
    }
  }
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.left),
    Math.max(VIEWPORT_MARGIN, viewportWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
  )
  const below = rect.top + rect.height + SPOTLIGHT_PAD + VIEWPORT_MARGIN
  const top =
    below + POPOVER_HEIGHT_ESTIMATE > viewportHeight
      ? Math.max(
          VIEWPORT_MARGIN,
          rect.top - SPOTLIGHT_PAD - VIEWPORT_MARGIN - POPOVER_HEIGHT_ESTIMATE,
        )
      : Math.max(VIEWPORT_MARGIN, below)
  return { top, left, width: POPOVER_WIDTH, maxWidth: 'calc(100vw - 16px)' }
}

function markTourDone(): void {
  try {
    window.localStorage.setItem(TOUR_DONE_KEY, 'true')
  } catch {
    // Storage can be unavailable (private mode, quota); losing the flag only
    // means the tour stays offerable, which is safe.
  }
}

/**
 * The toggleable end-to-end product tour.
 *
 * Rendered as a sibling of the router (same pattern as CommandMenu) so it
 * survives every route transition; it drives navigation through the
 * `onNavigate` prop instead of importing the router. The dim layer and the
 * spotlight are pointer-events-none on purpose: the page underneath stays
 * fully usable while the tour narrates it. It NEVER auto-opens — the only way
 * in is the window toggle event.
 */
interface ProductTourProps {
  readonly onNavigate: (route: string, params?: Readonly<Record<string, string>>) => void
}

export function ProductTour({ onNavigate }: ProductTourProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  // The measured rect remembers which step it was measured FOR, so a step
  // change invalidates it by derivation instead of a synchronous reset.
  const [found, setFound] = useState<{
    readonly step: number
    readonly rect: TargetRect
  } | null>(null)
  const rect = found !== null && found.step === stepIndex ? found.rect : null
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const openRef = useRef(false)
  // The element that had focus when the tour opened, so every close path
  // (Done, Skip, Escape, the toggle event) can hand focus back instead of
  // dropping it to <body> — the same contract CommandMenu gets from
  // finalFocus.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const hasOpenedRef = useRef(false)
  useEffect(() => {
    openRef.current = open
  }, [open])

  // Navigation happens in the handlers that change the step — never in an
  // effect — so the parent callback fires exactly once per user intent.
  const navigateForStep = useCallback(
    (index: number) => {
      const step = TOUR_STEPS[index]
      if (
        step?.route !== undefined &&
        window.location.pathname !== concretePath(step.route, step.params)
      ) {
        onNavigate(step.route, step.params)
      }
    },
    [onNavigate],
  )

  const goToStep = useCallback(
    (index: number) => {
      navigateForStep(index)
      setStepIndex(index)
    },
    [navigateForStep],
  )

  useEffect(() => {
    function onToggle(): void {
      if (!openRef.current) {
        setStepIndex(0)
        navigateForStep(0)
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      setOpen((previous) => !previous)
    }
    window.addEventListener(TOUR_TOGGLE_EVENT, onToggle)
    return () => {
      window.removeEventListener(TOUR_TOGGLE_EVENT, onToggle)
    }
  }, [navigateForStep])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.key !== 'Escape') return
      // Escape aimed at another dialog (e.g. the command menu opened over the
      // 'palette' step) or at an editable control dismisses THAT surface, not
      // the tour.
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('[role="dialog"]') !== null &&
        dialogRef.current?.contains(target) !== true
      ) {
        return
      }
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Navigate first, then chase the step's [data-tour] hook. The hook may take
  // a while to exist (the route is loading) or never appear at all (an
  // organizer page showing its signed-out state), so the popover renders
  // centered from the first frame and snaps to the target if one turns up
  // within the polling window — a missing target never blocks the tour.
  useEffect(() => {
    if (!open) return
    const step = TOUR_STEPS[stepIndex]
    if (step === undefined || step.target === undefined) return
    const startedAt = Date.now()
    function tick(): void {
      const element =
        step?.target === undefined ? null : document.querySelector(`[data-tour="${step.target}"]`)
      const measured = element === null ? null : measure(element)
      if (element !== null && measured !== null) {
        // An off-screen target would be spotlighted where the user cannot see
        // it (and could anchor the popover outside the viewport), so bring it
        // into view once per step, then re-measure at its settled position.
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        setFound({ step: stepIndex, rect: measure(element) ?? measured })
        return
      }
      if (Date.now() - startedAt < TARGET_POLL_MS) frame = requestAnimationFrame(tick)
    }
    let frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [open, stepIndex])

  useEffect(() => {
    if (!open) return
    function onResize(): void {
      const measured = findTarget(TOUR_STEPS[stepIndex]?.target)
      setFound(measured === null ? null : { step: stepIndex, rect: measured })
    }
    window.addEventListener('resize', onResize)
    // Capture phase so scrolls inside nested containers (rail, main lists)
    // re-anchor the fixed-position spotlight and popover, not just window
    // scroll.
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [open, stepIndex])

  // Focus follows the narration on open — but only when focus is not already
  // inside the popover, so a keyboard user advancing with Enter on Next keeps
  // their place; the progress live region announces the step change.
  useEffect(() => {
    if (open && !(dialogRef.current?.contains(document.activeElement) ?? false)) {
      dialogRef.current?.focus()
    }
  }, [open, stepIndex])

  // Hand focus back to wherever the tour was opened from on every close path.
  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true
      return
    }
    if (!hasOpenedRef.current) return
    const previous = returnFocusRef.current
    if (previous !== null && previous.isConnected) previous.focus()
  }, [open])

  const finish = useCallback(() => {
    markTourDone()
    setOpen(false)
  }, [])

  if (!open) return null
  const step = TOUR_STEPS[stepIndex]
  if (step === undefined) return null
  const lastStep = stepIndex === TOUR_STEPS.length - 1
  const titleId = `tour-step-title-${step.id}`
  const bodyId = `tour-step-body-${step.id}`

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 bg-black/10" />
      {rect !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-lg border-2 border-ring"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
          }}
        />
      ) : null}
      <dialog
        ref={dialogRef}
        open
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="fixed z-50 m-0 grid gap-3 rounded-xl border-0 bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-hidden focus-visible:ring-3 focus-visible:ring-ring"
        style={popoverStyle(rect)}
      >
        <div className="grid gap-1">
          <h2 id={titleId} className="font-heading text-base leading-snug font-medium">
            {step.title}
          </h2>
          <p id={bodyId} className="text-muted-foreground">
            {step.body}
          </p>
        </div>
        <StatusLive className="text-xs">
          Step {stepIndex + 1} of {TOUR_STEPS.length}: {step.title}
        </StatusLive>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={stepIndex === 0}
            onClick={() => goToStep(Math.max(0, stepIndex - 1))}
          >
            Back
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (lastStep) finish()
              else goToStep(stepIndex + 1)
            }}
          >
            {lastStep ? 'Done' : 'Next'}
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={finish}>
            Skip tour
          </Button>
        </div>
      </dialog>
    </>
  )
}
