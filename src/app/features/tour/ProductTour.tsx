import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'

import { Button } from '../../../components/ui/button'
import { AlertLive } from '../../../components/ui/alert-live'
import { StatusLive } from '../../../components/ui/status-live'
import { SECTION_HEADING_CLASS } from '../../../components/ui/section-heading'
import { endTourSession, startTourSession, type TourAccess } from '../../api/tour'
import { setTourActive } from './tour-activity'
import { consumePendingTourToggle, TOUR_ROUTE_EVENT, TOUR_TOGGLE_EVENT } from './tour-events'
import { clearTourProgress, readTourProgress, writeTourProgress } from './tour-progress'
import {
  claimTourLease,
  ownsTourLease,
  releaseTourLease,
  renewTourLease,
  TOUR_LEASE_KEY,
  TOUR_LEASE_TTL_MS,
  tourTabId,
} from './tour-lease'
import {
  computeTourPlacement,
  type TourBoxSize as BoxSize,
  type TourTargetRect as TargetRect,
} from './tour-positioning'
import {
  TOUR_CHAPTERS,
  TOUR_ORGANIZER_HOLD,
  TOUR_SIGN_IN_STEP_INDEX,
  TOUR_STEPS,
} from './tour-steps'

export { TOUR_TOGGLE_EVENT } from './tour-events'

/** Set when the tour is finished or skipped. The tour NEVER auto-opens. */
const TOUR_DONE_KEY = 'open-events:tour-done'
/** Tab-scoped resume marker; authority itself remains in an HttpOnly cookie. */
const TOUR_ACTIVE_KEY = 'open-events:tour-active'

/** How long a step waits for its [data-tour] hook before rendering centered. */
const TARGET_POLL_MS = 2000
/**
 * How often a held step re-checks for its hook. The hold is never a dead end:
 * the visitor may sign in, or a slow organizer route may simply have taken
 * longer than the poll window, and either way the hook turning up resumes the
 * narration by itself. A human cadence, not a frame loop — nothing is animating
 * while the tour is held.
 */
const HOLD_RECHECK_MS = 400
const POPOVER_WIDTH = 344
const SPOTLIGHT_PAD = 4

/** Substitute `$param` segments so a route can be compared to a pathname. */
function concretePath(route: string, params?: Readonly<Record<string, string>>): string {
  return route.replace(/\$([A-Za-z0-9_]+)/g, (segment, name: string) => params?.[name] ?? segment)
}

function measure(element: Element): TargetRect | null {
  const rect = element.getBoundingClientRect()
  const visual = window.visualViewport
  const viewportWidth = visual?.width ?? window.innerWidth
  const viewportHeight = visual?.height ?? window.innerHeight
  const top = Math.max(0, rect.top)
  const left = Math.max(0, rect.left)
  const right = Math.min(viewportWidth, rect.right)
  const bottom = Math.min(viewportHeight, rect.bottom)
  if (right <= left || bottom <= top) return null
  return { top, left, width: right - left, height: bottom - top }
}

function findTarget(target: string | undefined): TargetRect | null {
  if (target === undefined) return null
  const element = document.querySelector(`[data-tour="${target}"]`)
  return element === null ? null : measure(element)
}

function targetForStep(step: (typeof TOUR_STEPS)[number]): string | undefined {
  if (window.innerWidth < 640) return step.mobileTarget ?? undefined
  return step.target
}

function sameRect(left: TargetRect, right: TargetRect): boolean {
  return (
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  )
}

function popoverStyle(rect: TargetRect | null, popover: BoxSize): CSSProperties {
  const visual = window.visualViewport
  const placement = computeTourPlacement(rect, popover, {
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
  })
  return {
    top: placement.mode === 'dock' ? undefined : placement.top,
    bottom: placement.mode === 'dock' ? 12 : undefined,
    left: placement.left,
    width: placement.width,
    maxWidth: 'calc(100vw - 16px)',
    maxHeight: placement.maxHeight,
    overflowY: placement.maxHeight === undefined ? undefined : 'auto',
    boxSizing: 'border-box',
  }
}

function markTourDone(): void {
  try {
    window.localStorage.setItem(TOUR_DONE_KEY, 'true')
  } catch {
    // Storage can be unavailable (private mode, quota); losing the flag only
    // means the tour stays offerable, which is safe.
  }
}

function savedStepIndex(): number {
  const progress = readTourProgress()
  if (progress === null) return 0
  const index = TOUR_STEPS.findIndex((step) => step.id === progress.stepId)
  if (index !== -1) return index
  clearTourProgress()
  return 0
}

function setTourResume(active: boolean): void {
  try {
    if (active) window.sessionStorage.setItem(TOUR_ACTIVE_KEY, 'true')
    else window.sessionStorage.removeItem(TOUR_ACTIVE_KEY)
  } catch {
    // A storage-denied browser still gets the current uninterrupted tour. It
    // simply cannot resume the overlay after a full document reload.
  }
}

function shouldResumeTour(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).get('tour') === '1' ||
      window.sessionStorage.getItem(TOUR_ACTIVE_KEY) === 'true'
    )
  } catch {
    return false
  }
}

function clearTourQuery(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('tour')) return
  url.searchParams.delete('tour')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

/**
 * What a step SAYS, once the hold has had its way with it.
 *
 * A held step swaps its narration for the recovery, and swaps both footer
 * destinations with it: back goes to the one screen that can lift the hold,
 * forward leaves the organizer half rather than walking deeper into it. The
 * two buttons keep their positions so a keyboard user who pressed Next keeps
 * focus on the same control — the live region names what it became.
 */
interface StepCopy {
  readonly heading: string
  readonly narration: string
  readonly backLabel: string
  readonly forwardLabel: string
}

function stepCopy(
  step: (typeof TOUR_STEPS)[number],
  held: boolean,
  organizerHold: boolean,
  lastStep: boolean,
): StepCopy {
  return {
    heading: held
      ? organizerHold
        ? TOUR_ORGANIZER_HOLD.title
        : 'Could not highlight this section'
      : step.title,
    narration: held
      ? organizerHold
        ? TOUR_ORGANIZER_HOLD.body
        : 'The page opened, but its feature target did not become ready. Retry or continue without the highlight.'
      : step.body,
    backLabel: held ? (organizerHold ? 'Back to sign-in' : 'Retry') : 'Back',
    forwardLabel: held
      ? organizerHold
        ? 'Continue with public chapters'
        : 'Continue without highlight'
      : lastStep
        ? 'Done'
        : 'Next',
  }
}

/**
 * The halo around the step's target. Hairline ring plus the overlay shadow, so
 * it reads as the same material as the popover; it glides to the next target on
 * the house 100ms rather than teleporting.
 */
function TourSpotlight({ rect }: { readonly rect: TargetRect }): ReactElement {
  return (
    <div
      aria-hidden="true"
      data-tour-motion
      className="pointer-events-none fixed z-40 rounded-md shadow-popover ring-2 ring-ring/70 transition-[top,left,width,height] animation-duration-100 ease-entrance motion-reduce:transition-none motion-reduce:animate-none"
      style={{
        top: rect.top - SPOTLIGHT_PAD,
        left: rect.left - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
      }}
    />
  )
}

/** The step's eyebrow, title and body — everything the popover says. */
function TourNarration({
  index,
  journey,
  copy,
  titleId,
  bodyId,
}: {
  readonly index: number
  readonly journey: string
  readonly copy: StepCopy
  readonly titleId: string
  readonly bodyId: string
}): ReactElement {
  return (
    <div className="grid gap-2.5">
      {/* The counter is the step's eyebrow AND its announcement: one live
          region, reading "Step N of M" on screen and naming the step for
          anyone who cannot see which card just changed. */}
      <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
        <span className="uppercase tracking-[0.12em] text-link">{journey} journey</span>
        <StatusLive className="tabular-nums">
          Step {index + 1} of {TOUR_STEPS.length}
          <span className="sr-only">: {copy.heading}</span>
        </StatusLive>
      </div>
      <div
        role="progressbar"
        aria-label="Tour progress"
        aria-valuemin={1}
        aria-valuemax={TOUR_STEPS.length}
        aria-valuenow={index + 1}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          aria-hidden="true"
          className="h-full rounded-full bg-primary transition-[width] animation-duration-150 motion-reduce:transition-none"
          style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }}
        />
      </div>
      <div className="grid gap-1.5">
        <h2 id={titleId} className={SECTION_HEADING_CLASS}>
          {copy.heading}
        </h2>
        <p id={bodyId} className="text-muted-foreground">
          {copy.narration}
        </p>
      </div>
    </div>
  )
}

function journeyLabel(step: (typeof TOUR_STEPS)[number]): string {
  if (step.chapter === 'orientation') return 'Overview'
  if (step.chapter === 'organizer') return 'Organizer'
  if (step.chapter === 'submitter') return 'Submitter'
  if (step.chapter === 'speaker') return 'Speaker'
  if (step.chapter === 'reviewer') return 'Reviewer'
  return 'Attendee'
}

/**
 * Dialog footer grammar: hairline rule to the panel edges, 12px pad, the exit
 * on the left and the forward ramp on the right.
 */
function TourFooter({
  copy,
  backDisabled,
  onPause,
  onEnd,
  onGuidedAction,
  guidedAction,
  guidedAvailable,
  onBack,
  onForward,
  pending,
}: {
  readonly copy: StepCopy
  readonly backDisabled: boolean
  readonly onPause: () => void
  readonly onEnd: () => void
  readonly onGuidedAction: () => void
  readonly guidedAction: boolean
  readonly guidedAvailable: boolean
  readonly onBack: () => void
  readonly onForward: () => void
  readonly pending: boolean
}): ReactElement {
  return (
    <div className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 rounded-b-lg border-t border-border bg-popover p-3">
      <Button type="button" variant="ghost" className="min-h-11" onClick={onPause}>
        Pause tour
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 px-2" onClick={onEnd}>
        End tour
      </Button>
      {guidedAvailable ? (
        <Button type="button" variant="outline" className="min-h-11" onClick={onGuidedAction}>
          {guidedAction ? 'Return to tour' : 'Try it'}
        </Button>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={backDisabled || pending}
          onClick={onBack}
        >
          {copy.backLabel}
        </Button>
        <Button
          type="button"
          className="min-h-11"
          pending={pending}
          disabled={pending}
          onClick={onForward}
        >
          {copy.forwardLabel}
        </Button>
      </div>
    </div>
  )
}

function TourCompletion({
  onExplore,
  onSignIn,
  onRestart,
}: {
  readonly onExplore: () => void
  readonly onSignIn: () => void
  readonly onRestart: () => void
}): ReactElement {
  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-40 bg-scrim/60" />
      <dialog
        open
        aria-modal="true"
        aria-labelledby="tour-complete-title"
        className="fixed top-1/2 left-1/2 z-50 m-0 grid w-[min(28rem,calc(100vw-1rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border-0 bg-popover p-5 text-sm text-popover-foreground shadow-popover ring-1 ring-border"
      >
        <div className="grid gap-2">
          <p className="text-xs font-semibold tracking-[0.12em] text-link uppercase">Complete</p>
          <h2 id="tour-complete-title" className={SECTION_HEADING_CLASS}>
            One proposal, ready for an audience
          </h2>
          <p className="text-muted-foreground">
            You followed DemoConf from CFP intake through review, onboarding, agenda, and public
            discovery. Temporary access is closed.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button className="min-h-11" onClick={onExplore}>
            Explore DemoConf
          </Button>
          <Button className="min-h-11" variant="outline" onClick={onSignIn}>
            Organizer sign-in
          </Button>
          <Button className="min-h-11" variant="outline" onClick={onRestart}>
            Restart tour
          </Button>
          <a
            href="https://github.com/MoizIbnYousaf/open-events"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 font-medium"
          >
            View source
          </a>
        </div>
      </dialog>
    </>
  )
}

/**
 * The toggleable end-to-end product tour.
 *
 * The spotlight, the narration and the footer are their own components in this
 * file: the tour is one behaviour — measure, hold, narrate — and everything
 * below is what that behaviour prints. Keeping the printing out of the way is
 * what leaves the behaviour readable (react-doctor/no-giant-component). They
 * stay in this file because it is reached by the entry chunk, which is held to
 * a gzip budget.
 *
 * Rendered as a sibling of the router (same pattern as CommandMenu) so it
 * survives every route transition; it drives navigation through the
 * `onNavigate` prop instead of importing the router. Observe mode blocks the
 * page and traps focus; guided mode opens only the declared target. It NEVER
 * auto-opens without an explicit query, active checkpoint, or toggle intent.
 */
interface ProductTourProps {
  readonly onNavigate: (
    route: string,
    params?: Readonly<Record<string, string>>,
  ) => void | Promise<void>
  readonly onResume?: () => void
  readonly onAccessExit?: () => void
}

export function ProductTour({
  onNavigate,
  onResume,
  onAccessExit,
}: ProductTourProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [guidedAction, setGuidedAction] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [visitedStepIds, setVisitedStepIds] = useState<readonly string[]>([])
  // The measured rect remembers which step it was measured FOR, so a step
  // change invalidates it by derivation instead of a synchronous reset.
  const [found, setFound] = useState<{
    readonly step: number
    readonly rect: TargetRect
  } | null>(null)
  const rect = found !== null && found.step === stepIndex ? found.rect : null
  // Which step, if any, is held because its organizer surface never rendered.
  // Stored as an index for the same reason `found` is: a step change
  // invalidates it by derivation, so no handler has to remember to clear it.
  const [heldStep, setHeldStep] = useState<number | null>(null)
  const held = heldStep === stepIndex
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [popoverSize, setPopoverSize] = useState<BoxSize>({ width: POPOVER_WIDTH, height: 252 })
  const openRef = useRef(false)
  // The element that had focus when the tour opened, so every close path
  // (Done, Skip, Escape, the toggle event) can hand focus back instead of
  // dropping it to <body> — the same contract CommandMenu gets from
  // finalFocus.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const hasOpenedRef = useRef(false)
  const startingRef = useRef(false)
  const transitioningRef = useRef(false)
  const transitionGenerationRef = useRef(0)
  const navigationPathRef = useRef<string | null>(null)
  const endingRef = useRef<Promise<void> | null>(null)
  const autoStartRef = useRef(false)
  const accessRef = useRef<(typeof TOUR_STEPS)[number]['access']>('public')
  const tabIdRef = useRef<string | null>(null)
  if (tabIdRef.current === null) tabIdRef.current = tourTabId()
  useEffect(() => {
    openRef.current = open
  }, [open])

  useEffect(() => {
    if (!open || dialogRef.current === null) return
    const dialog = dialogRef.current
    const update = () => {
      const bounds = dialog.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) {
        setPopoverSize((current) =>
          Math.abs(current.width - bounds.width) < 0.5 &&
          Math.abs(current.height - bounds.height) < 0.5
            ? current
            : { width: bounds.width, height: bounds.height },
        )
      }
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(dialog)
    return () => observer.disconnect()
  }, [open, stepIndex])

  // Navigation happens in the handlers that change the step — never in an
  // effect — so the parent callback fires exactly once per user intent.
  const navigateForStep = useCallback(
    async (index: number) => {
      const step = TOUR_STEPS[index]
      if (step?.route !== undefined) {
        const path = concretePath(step.route, step.params)
        if (window.location.pathname !== path) {
          navigationPathRef.current = path
          try {
            await onNavigate(step.route, step.params)
          } finally {
            navigationPathRef.current = null
          }
        }
      }
    },
    [onNavigate],
  )

  const navigateToNeutral = useCallback(async () => {
    navigationPathRef.current = '/'
    try {
      await onNavigate('/')
    } finally {
      if (navigationPathRef.current === '/') navigationPathRef.current = null
    }
  }, [onNavigate])

  const goToStep = useCallback(
    async (index: number) => {
      if (transitioningRef.current) return
      const step = TOUR_STEPS[index]
      if (step === undefined) return
      transitioningRef.current = true
      setTransitioning(true)
      setGuidedAction(false)
      setStartError(null)
      const generation = ++transitionGenerationRef.current
      try {
        if (step.access !== accessRef.current) {
          if (step.access !== 'public') {
            const result = await startTourSession(step.access satisfies TourAccess)
            if (result.mode === 'redirect') {
              window.location.assign(result.url)
              return
            }
          } else {
            await endTourSession()
          }
          accessRef.current = step.access
        }
        if (generation !== transitionGenerationRef.current) {
          await endTourSession()
          return
        }
        await navigateForStep(index)
        if (generation !== transitionGenerationRef.current) return
        setStepIndex(index)
        setVisitedStepIds((current) => {
          const next = [...new Set([...current, step.id])]
          writeTourProgress(step.id, 'active', next)
          return next
        })
      } catch {
        setStartError('That tour screen could not open. Try again.')
      } finally {
        if (generation === transitionGenerationRef.current) {
          transitioningRef.current = false
          setTransitioning(false)
        }
      }
    },
    [navigateForStep],
  )

  const beginTour = useCallback(async () => {
    if (startingRef.current) return
    startingRef.current = true
    setStartError(null)
    const tabId = tabIdRef.current
    if (tabId !== null && !claimTourLease(tabId)) {
      setStartError('The guided tour is active in another tab. Return there or try again shortly.')
      openRef.current = true
      setOpen(true)
      startingRef.current = false
      return
    }
    const savedProgress = readTourProgress()
    const resumeIndex = savedStepIndex()
    const resumeStep = TOUR_STEPS[resumeIndex] ?? TOUR_STEPS[0]
    if (resumeStep === undefined) return
    const initialVisited = savedProgress?.visitedStepIds ?? [resumeStep.id]
    setStepIndex(resumeIndex)
    setVisitedStepIds(initialVisited)
    setCompleted(false)
    setGuidedAction(false)
    setHeldStep(null)
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    try {
      await endingRef.current
      if (resumeStep.access === 'public') {
        const result = await startTourSession('public')
        if (result.mode === 'redirect') {
          window.location.assign(result.url)
          return
        }
      } else {
        const result = await startTourSession(resumeStep.access satisfies TourAccess)
        if (result.mode === 'redirect') {
          window.location.assign(result.url)
          return
        }
      }
      accessRef.current = resumeStep.access
      if (savedProgress?.status === 'paused') onResume?.()
      setTourResume(true)
      writeTourProgress(resumeStep.id, 'active', initialVisited)
      clearTourQuery()
      await navigateForStep(resumeIndex)
      openRef.current = true
      setOpen(true)
    } catch {
      setStartError('The guided tour could not start. Try again.')
      openRef.current = true
      setOpen(true)
    } finally {
      startingRef.current = false
    }
  }, [navigateForStep, onResume])

  const closeTour = useCallback(
    async (disposition: 'pause' | 'end' | 'complete') => {
      transitionGenerationRef.current += 1
      transitioningRef.current = true
      setTransitioning(true)
      setGuidedAction(false)
      setStartError(null)
      const step = TOUR_STEPS[stepIndex]
      const ending = endTourSession()
      endingRef.current = ending
      try {
        await ending
        onAccessExit?.()
        accessRef.current = 'public'
        if (tabIdRef.current !== null) releaseTourLease(tabIdRef.current)
        setTourResume(false)
        if (disposition === 'pause' && step !== undefined) {
          writeTourProgress(step.id, 'paused', visitedStepIds)
        } else {
          clearTourProgress()
        }
        if (disposition === 'complete') {
          markTourDone()
          setCompleted(true)
          openRef.current = true
          setOpen(true)
        } else {
          openRef.current = false
          setOpen(false)
          await navigateToNeutral()
        }
      } catch {
        setStartError('Temporary tour access could not close. Retry cleanup before leaving.')
        openRef.current = true
        setOpen(true)
      } finally {
        if (endingRef.current === ending) endingRef.current = null
        transitioningRef.current = false
        setTransitioning(false)
      }
    },
    [navigateToNeutral, onAccessExit, stepIndex, visitedStepIds],
  )

  const pauseForExternalLeaseLoss = useCallback(() => {
    transitionGenerationRef.current += 1
    transitioningRef.current = false
    setTransitioning(false)
    setGuidedAction(false)
    onAccessExit?.()
    accessRef.current = 'public'
    setTourResume(false)
    const step = TOUR_STEPS[stepIndex]
    if (step !== undefined) writeTourProgress(step.id, 'paused', visitedStepIds)
    openRef.current = false
    setOpen(false)
    void navigateToNeutral()
  }, [navigateToNeutral, onAccessExit, stepIndex, visitedStepIds])

  useEffect(() => {
    function onToggle(): void {
      consumePendingTourToggle()
      if (!openRef.current) {
        void beginTour()
        return
      }
      void closeTour('pause')
    }
    window.addEventListener(TOUR_TOGGLE_EVENT, onToggle)
    if (consumePendingTourToggle()) queueMicrotask(() => void beginTour())
    return () => {
      window.removeEventListener(TOUR_TOGGLE_EVENT, onToggle)
    }
  }, [beginTour, closeTour])

  useEffect(() => {
    if (autoStartRef.current || !shouldResumeTour()) return
    autoStartRef.current = true
    void beginTour()
  }, [beginTour])

  useEffect(() => {
    if (!open) return
    const current = TOUR_STEPS[stepIndex]
    if (
      !transitioning &&
      current?.route !== undefined &&
      window.location.pathname !== concretePath(current.route, current.params)
    ) {
      queueMicrotask(() => void closeTour('pause'))
      return
    }
    const pauseIfDiverged = (pathname: unknown) => {
      const expected = TOUR_STEPS[stepIndex]
      if (pathname === navigationPathRef.current) return
      if (expected?.route === undefined) return
      if (pathname !== concretePath(expected.route, expected.params)) {
        void closeTour('pause')
      }
    }
    const onRouteResolved = (event: Event) => {
      pauseIfDiverged(event instanceof CustomEvent ? event.detail : undefined)
    }
    const onPopState = () => pauseIfDiverged(window.location.pathname)
    window.addEventListener(TOUR_ROUTE_EVENT, onRouteResolved)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener(TOUR_ROUTE_EVENT, onRouteResolved)
      window.removeEventListener('popstate', onPopState)
    }
  }, [closeTour, open, stepIndex, transitioning])

  useEffect(() => {
    if (!open || completed || tabIdRef.current === null) return
    const tabId = tabIdRef.current
    const renew = () => {
      if (!renewTourLease(tabId)) pauseForExternalLeaseLoss()
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === TOUR_LEASE_KEY && !ownsTourLease(tabId)) {
        pauseForExternalLeaseLoss()
      }
    }
    renew()
    const interval = window.setInterval(renew, Math.floor(TOUR_LEASE_TTL_MS / 3))
    window.addEventListener('storage', onStorage)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('storage', onStorage)
    }
  }, [completed, open, pauseForExternalLeaseLoss])

  useEffect(() => {
    const onPageHide = () => {
      if (!openRef.current) return
      void endTourSession({ keepalive: true })
      if (tabIdRef.current !== null) releaseTourLease(tabIdRef.current)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.key !== 'Escape') return
      // Escape aimed at a surface stacked ON TOP of the tour — the command menu
      // opened over the 'palette' step — dismisses that surface, not the tour;
      // a deeper overlay owns the key while it is up, and anything it wants to
      // keep (the palette's clear-the-query rung) it already marks handled.
      //
      // Depth is the ONLY scoping rule here. An editable control underneath the
      // popover is not a stacked surface: the page below the tour stays usable
      // by design, so focus can legitimately be sitting in one of its fields
      // while the tour narrates it. Bailing on editable targets made the tour
      // undismissable from the keyboard exactly there (F-R4-4) — while the
      // popover is open, Escape always closes it.
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('[role="dialog"]') !== null &&
        dialogRef.current?.contains(target) !== true
      ) {
        return
      }
      event.preventDefault()
      void closeTour('pause')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeTour, open])

  // Navigate first, then chase the step's [data-tour] hook. The hook may take a
  // while to exist (the route is loading), so the popover renders centered from
  // the first frame and snaps to the target if one turns up within the polling
  // window.
  //
  // What the window closing MEANS depends on the step. For an ordinary step,
  // nothing: a decorative anchor is missing and the narration stands on its own
  // centered. For a step marked `requiresSession`, the missing hook is the
  // whole answer — the organizer route returned a state card instead of its
  // rail — and narrating "Taxonomies — tracks, rooms and session formats live
  // here" over "Access forbidden" is the defect this gate exists to stop. Those
  // steps hold instead, and keep watching so signing in resumes them.
  useEffect(() => {
    if (!open) return
    const step = TOUR_STEPS[stepIndex]
    if (step === undefined) return
    const target = targetForStep(step)
    if (target === undefined) return
    const mustResolve = step.targetPolicy === 'required'
    const startedAt = Date.now()
    let frame = 0
    let recheck: ReturnType<typeof setInterval> | undefined

    /** True once the hook exists with real layout; also lifts an active hold. */
    function look(): boolean {
      const element = document.querySelector(`[data-tour="${target}"]`)
      const measured = element === null ? null : measure(element)
      if (element === null || measured === null) return false
      // An off-screen target would be spotlighted where the user cannot see it
      // (and could anchor the popover outside the viewport), so bring it into
      // view once per step, then re-measure at its settled position.
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const nextRect = measure(element) ?? measured
      setFound((current) =>
        current?.step === stepIndex && sameRect(current.rect, nextRect)
          ? current
          : { step: stepIndex, rect: nextRect },
      )
      setHeldStep((current) => (current === stepIndex ? null : current))
      return true
    }

    /** True once the step resolved; otherwise decides whether to hold yet. */
    function settle(): boolean {
      if (look()) return true
      // A route that is still fetching says so — every organizer screen renders
      // an aria-busy skeleton while its query is in flight. Holding on one
      // would tell a signed-in organizer on a slow connection to sign in, so a
      // busy page is not yet an answer: keep watching instead.
      if (document.querySelector('[aria-busy="true"]') === null) setHeldStep(stepIndex)
      return false
    }

    function tick(): void {
      if (look()) return
      if (Date.now() - startedAt < TARGET_POLL_MS) {
        frame = requestAnimationFrame(tick)
        return
      }
      if (!mustResolve || settle()) return
      recheck = setInterval(() => {
        if (settle()) clearInterval(recheck)
      }, HOLD_RECHECK_MS)
    }

    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      if (recheck !== undefined) clearInterval(recheck)
    }
  }, [open, stepIndex])

  useEffect(() => {
    if (!open) return
    function onResize(event?: Event): void {
      if (
        event?.type === 'scroll' &&
        dialogRef.current !== null &&
        (event.composedPath().includes(dialogRef.current) ||
          (event.target instanceof Node && dialogRef.current.contains(event.target)))
      ) {
        return
      }
      const step = TOUR_STEPS[stepIndex]
      const measured = step === undefined ? null : findTarget(targetForStep(step))
      setFound((current) =>
        measured === null
          ? null
          : current?.step === stepIndex && sameRect(current.rect, measured)
            ? current
            : { step: stepIndex, rect: measured },
      )
    }
    const step = TOUR_STEPS[stepIndex]
    const target = step === undefined ? undefined : targetForStep(step)
    const element = target === undefined ? null : document.querySelector(`[data-tour="${target}"]`)
    const observer =
      element === null || typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => onResize())
    if (element !== null) observer?.observe(element)
    window.addEventListener('resize', onResize)
    // Capture phase so scrolls inside nested containers (rail, main lists)
    // re-anchor the fixed-position spotlight and popover, not just window
    // scroll.
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
      observer?.disconnect()
    }
  }, [open, stepIndex])

  // Publish "the tour is narrating" for the surfaces the tour navigates INTO,
  // so a route that would normally grab focus on mount (the organizer sign-in
  // field) can leave it in the popover instead. Cleared on every close path and
  // on unmount, so nothing can strand the flag on the document.
  useEffect(() => {
    setTourActive(open)
    return () => {
      setTourActive(false)
    }
  }, [open])

  // Focus follows the narration on open — but only when focus is not already
  // inside the popover, so a keyboard user advancing with Enter on Next keeps
  // their place; the progress live region announces the step change.
  useEffect(() => {
    if (open && !(dialogRef.current?.contains(document.activeElement) ?? false)) {
      dialogRef.current?.focus()
    }
  }, [open, stepIndex])

  useEffect(() => {
    if (!open || completed) return
    const step = TOUR_STEPS[stepIndex]
    if (step === undefined) return
    const target = targetForStep(step)
    const targetElement =
      target === undefined ? null : document.querySelector(`[data-tour="${target}"]`)
    const allowed = (node: Node | null): boolean =>
      node !== null &&
      (dialogRef.current?.contains(node) === true ||
        (guidedAction && targetElement?.contains(node) === true))
    const onFocus = (event: FocusEvent): void => {
      if (!allowed(event.target instanceof Node ? event.target : null)) dialogRef.current?.focus()
    }
    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || guidedAction || dialogRef.current === null) return
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button, a, select'),
      ).filter((control) => !control.hasAttribute('disabled'))
      if (controls.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('focusin', onFocus)
    document.addEventListener('keydown', onTab)
    return () => {
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('keydown', onTab)
    }
  }, [completed, guidedAction, open, stepIndex])

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

  const finish = useCallback(() => void closeTour('complete'), [closeTour])
  const pause = useCallback(() => void closeTour('pause'), [closeTour])
  const end = useCallback(() => void closeTour('end'), [closeTour])

  if (!open) return null
  if (completed) {
    const leaveCompletion = (route: string, params?: Readonly<Record<string, string>>): void => {
      setCompleted(false)
      openRef.current = false
      setOpen(false)
      void onNavigate(route, params)
    }
    return (
      <TourCompletion
        onExplore={() => leaveCompletion('/schedule/$eventSlug', { eventSlug: 'demo-conf-2026' })}
        onSignIn={() => leaveCompletion('/admin')}
        onRestart={() => {
          clearTourProgress()
          setCompleted(false)
          setVisitedStepIds([])
          setStepIndex(0)
          void beginTour()
        }}
      />
    )
  }
  const step = TOUR_STEPS[stepIndex]
  if (step === undefined) return null
  const firstUnvisitedIndex = TOUR_STEPS.findIndex(
    (candidate) => !visitedStepIds.includes(candidate.id),
  )
  const lastStep = stepIndex === TOUR_STEPS.length - 1 && firstUnvisitedIndex === -1
  const titleId = `tour-step-title-${step.id}`
  const bodyId = `tour-step-body-${step.id}`

  const organizerHold = held && step.requiresSession === 'organizer'
  const copy = stepCopy(step, held, organizerHold, lastStep)

  function goBack(): void {
    if (held && !organizerHold) {
      setHeldStep(null)
      navigateForStep(stepIndex).catch(() => setStartError('That screen could not reload.'))
      return
    }
    void goToStep(held ? Math.max(0, TOUR_SIGN_IN_STEP_INDEX) : Math.max(0, stepIndex - 1))
  }

  function goForward(): void {
    if (organizerHold) {
      const resume = TOUR_STEPS.findIndex(
        (candidate, index) => index > stepIndex && candidate.requiresSession === undefined,
      )
      if (resume === -1) finish()
      else {
        // A public step may be routeless (the command-menu trigger is global).
        // Move the page to the next public route first so its target can render
        // somewhere honest, but keep the narration on that earlier public
        // step. Advancing once more then reaches the route already on screen.
        if (TOUR_STEPS[resume]?.route === undefined) {
          const routeContext = TOUR_STEPS.findIndex(
            (candidate, index) =>
              index > resume &&
              candidate.requiresSession === undefined &&
              candidate.route !== undefined,
          )
          if (routeContext !== -1) navigateForStep(routeContext)
        }
        void goToStep(resume)
      }
      return
    }
    if (held) {
      setHeldStep(null)
      if (stepIndex === TOUR_STEPS.length - 1) finish()
      else void goToStep(stepIndex + 1)
      return
    }
    if (stepIndex === TOUR_STEPS.length - 1 && firstUnvisitedIndex !== -1) {
      void goToStep(firstUnvisitedIndex)
    } else if (lastStep) finish()
    else void goToStep(stepIndex + 1)
  }

  function toggleGuidedAction(): void {
    if (guidedAction) {
      setGuidedAction(false)
      dialogRef.current?.focus()
      return
    }
    const activeStep = TOUR_STEPS[stepIndex]
    if (activeStep === undefined) return
    const target = targetForStep(activeStep)
    const element = target === undefined ? null : document.querySelector(`[data-tour="${target}"]`)
    if (element === null) return
    setGuidedAction(true)
    const focusable = element.querySelector<HTMLElement>('button, input, select, textarea, a')
    ;(focusable ?? (element instanceof HTMLElement ? element : null))?.focus()
  }

  return (
    <>
      {/* The page remains legible, but observe mode intercepts pointer input;
          guided mode releases the declared target while focus containment
          limits keyboard interaction to the same contract. */}
      <div
        aria-hidden="true"
        data-tour-motion
        className={`${guidedAction ? 'pointer-events-none' : 'pointer-events-auto'} fixed inset-0 z-40 bg-scrim/50 animation-duration-150 ease-entrance animate-in fade-in-0 motion-reduce:transition-none motion-reduce:animate-none`}
      />
      {rect === null ? null : <TourSpotlight rect={rect} />}
      <dialog
        ref={dialogRef}
        open
        data-tour-motion
        aria-modal={guidedAction ? undefined : 'true'}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        // Same surface as every other overlay in the product: popover fill,
        // 8px radius, one hairline, the zero-offset halo. The entrance is
        // opacity-only rather than the shared fade + 2% zoom because this
        // popover is positioned by measurement and centres itself with a live
        // `transform` — a scale keyframe would fight that transform and throw
        // the first (centred) step across the screen on the way in.
        className="fixed z-50 m-0 flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-lg border-0 bg-popover p-0 text-sm text-popover-foreground shadow-popover ring-1 ring-border outline-hidden [box-sizing:border-box] animation-duration-150 ease-entrance animate-in fade-in-0 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:animate-none"
        style={popoverStyle(rect, popoverSize)}
      >
        <div className="pointer-events-none grid min-h-0 flex-1 gap-3 overflow-y-auto p-4">
          <TourNarration
            index={stepIndex}
            journey={journeyLabel(step)}
            copy={copy}
            titleId={titleId}
            bodyId={bodyId}
          />
          <label className="grid gap-1 text-xs text-muted-foreground">
            Chapter
            <select
              className="pointer-events-auto min-h-11 rounded-md border border-input bg-card px-2 text-sm text-foreground"
              value={step.chapter}
              onChange={(event) => {
                const index = TOUR_STEPS.findIndex(
                  (candidate) => candidate.chapter === event.target.value,
                )
                if (index >= 0) void goToStep(index)
              }}
            >
              {TOUR_CHAPTERS.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.label}
                </option>
              ))}
            </select>
          </label>
          {startError === null ? null : <AlertLive>{startError}</AlertLive>}
        </div>
        <TourFooter
          copy={copy}
          backDisabled={!held && stepIndex === 0}
          onPause={pause}
          onEnd={end}
          guidedAvailable={step.mode === 'guided' && rect !== null}
          guidedAction={guidedAction}
          onGuidedAction={toggleGuidedAction}
          onBack={goBack}
          onForward={goForward}
          pending={transitioning}
        />
      </dialog>
    </>
  )
}
