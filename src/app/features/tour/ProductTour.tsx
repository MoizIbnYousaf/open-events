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
import { consumePendingTourToggle, TOUR_TOGGLE_EVENT } from './tour-events'
import { clearTourProgress, readTourProgress, writeTourProgress } from './tour-progress'
import { TOUR_ORGANIZER_HOLD, TOUR_SIGN_IN_STEP_INDEX, TOUR_STEPS } from './tour-steps'

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
const POPOVER_HEIGHT_ESTIMATE = 252
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

function stepCopy(step: (typeof TOUR_STEPS)[number], held: boolean, lastStep: boolean): StepCopy {
  return {
    heading: held ? TOUR_ORGANIZER_HOLD.title : step.title,
    narration: held ? TOUR_ORGANIZER_HOLD.body : step.body,
    backLabel: held ? 'Back to sign-in' : 'Back',
    forwardLabel: held ? 'Skip to public screens' : lastStep ? 'Done' : 'Next',
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
      className="pointer-events-none fixed z-40 rounded-md shadow-popover ring-2 ring-ring/70 transition-[top,left,width,height] animation-duration-100 ease-entrance"
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
  if (step.id === 'welcome') return 'Overview'
  if (step.access === 'organizer') return 'Organizer'
  if (step.access === 'portal') return 'Speaker'
  if (step.access === 'evaluation') return 'Reviewer'
  if (step.id === 'public-cfp' || step.id === 'start') return 'Submitter'
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
  onSkip,
  onBack,
  onForward,
  pending,
}: {
  readonly copy: StepCopy
  readonly backDisabled: boolean
  readonly onPause: () => void
  readonly onSkip: () => void
  readonly onBack: () => void
  readonly onForward: () => void
  readonly pending: boolean
}): ReactElement {
  return (
    <div className="-mx-4 -mb-4 flex flex-wrap items-center gap-2 rounded-b-lg border-t border-border p-3">
      <Button type="button" variant="ghost" onClick={onPause}>
        Pause tour
      </Button>
      <Button type="button" variant="ghost" className="px-2" onClick={onSkip}>
        Skip tour
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" variant="outline" disabled={backDisabled || pending} onClick={onBack}>
          {copy.backLabel}
        </Button>
        <Button type="button" pending={pending} disabled={pending} onClick={onForward}>
          {copy.forwardLabel}
        </Button>
      </div>
    </div>
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
 * `onNavigate` prop instead of importing the router. The dim layer and the
 * spotlight are pointer-events-none on purpose: the page underneath stays
 * fully usable while the tour narrates it. It NEVER auto-opens — the only way
 * in is the window toggle event.
 */
interface ProductTourProps {
  readonly onNavigate: (route: string, params?: Readonly<Record<string, string>>) => void
  readonly onResume?: () => void
}

export function ProductTour({ onNavigate, onResume }: ProductTourProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
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
  const openRef = useRef(false)
  // The element that had focus when the tour opened, so every close path
  // (Done, Skip, Escape, the toggle event) can hand focus back instead of
  // dropping it to <body> — the same contract CommandMenu gets from
  // finalFocus.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const hasOpenedRef = useRef(false)
  const startingRef = useRef(false)
  const endingRef = useRef<Promise<void> | null>(null)
  const autoStartRef = useRef(false)
  const accessRef = useRef<(typeof TOUR_STEPS)[number]['access']>('public')
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
    async (index: number) => {
      if (transitioning) return
      const step = TOUR_STEPS[index]
      if (step === undefined) return
      setTransitioning(true)
      setStartError(null)
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
        navigateForStep(index)
        setStepIndex(index)
        writeTourProgress(step.id, 'active')
      } catch {
        setStartError('That tour screen could not open. Try again.')
      } finally {
        setTransitioning(false)
      }
    },
    [navigateForStep, transitioning],
  )

  const beginTour = useCallback(async () => {
    if (startingRef.current) return
    startingRef.current = true
    setStartError(null)
    const savedProgress = readTourProgress()
    const resumeIndex = savedStepIndex()
    const resumeStep = TOUR_STEPS[resumeIndex] ?? TOUR_STEPS[0]
    if (resumeStep === undefined) return
    setStepIndex(resumeIndex)
    setHeldStep(null)
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    try {
      await endingRef.current
      if (resumeStep.access === 'public') {
        await endTourSession()
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
      writeTourProgress(resumeStep.id, 'active')
      clearTourQuery()
      navigateForStep(resumeIndex)
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
    (disposition: 'pause' | 'complete') => {
      const step = TOUR_STEPS[stepIndex]
      if (disposition === 'complete') {
        markTourDone()
        clearTourProgress()
      } else if (step !== undefined) {
        writeTourProgress(step.id, 'paused')
      }
      setTourResume(false)
      accessRef.current = 'public'
      openRef.current = false
      setOpen(false)
      const ending = endTourSession()
        .catch(() => undefined)
        .finally(() => {
          if (endingRef.current === ending) endingRef.current = null
        })
      endingRef.current = ending
    },
    [stepIndex],
  )

  useEffect(() => {
    function onToggle(): void {
      consumePendingTourToggle()
      if (!openRef.current) {
        void beginTour()
        return
      }
      closeTour('pause')
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
      closeTour('pause')
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
    const target = step.target
    if (target === undefined) return
    const gated = step.requiresSession !== undefined
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
      setFound({ step: stepIndex, rect: measure(element) ?? measured })
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
      if (!gated || settle()) return
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

  const finish = useCallback(() => closeTour('complete'), [closeTour])
  const pause = useCallback(() => closeTour('pause'), [closeTour])

  if (!open) return null
  const step = TOUR_STEPS[stepIndex]
  if (step === undefined) return null
  const lastStep = stepIndex === TOUR_STEPS.length - 1
  const titleId = `tour-step-title-${step.id}`
  const bodyId = `tour-step-body-${step.id}`

  const copy = stepCopy(step, held, lastStep)

  function goBack(): void {
    void goToStep(held ? Math.max(0, TOUR_SIGN_IN_STEP_INDEX) : Math.max(0, stepIndex - 1))
  }

  function goForward(): void {
    if (held) {
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
    if (lastStep) finish()
    else void goToStep(stepIndex + 1)
  }

  return (
    <>
      {/* The narration dim is deliberately lighter than a modal scrim — the
          page underneath stays legible and usable while the tour talks about
          it — but it is derived from the same token, so it deepens in dark
          mode exactly like every other overlay. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-40 bg-scrim/50 animation-duration-150 ease-entrance animate-in fade-in-0"
      />
      {rect === null ? null : <TourSpotlight rect={rect} />}
      <dialog
        ref={dialogRef}
        open
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        // Same surface as every other overlay in the product: popover fill,
        // 8px radius, one hairline, the zero-offset halo. The entrance is
        // opacity-only rather than the shared fade + 2% zoom because this
        // popover is positioned by measurement and centres itself with a live
        // `transform` — a scale keyframe would fight that transform and throw
        // the first (centred) step across the screen on the way in.
        className="fixed z-50 m-0 grid gap-3 rounded-lg border-0 bg-popover p-4 text-sm text-popover-foreground shadow-popover ring-1 ring-border outline-hidden animation-duration-150 ease-entrance animate-in fade-in-0 focus-visible:ring-2 focus-visible:ring-ring"
        style={popoverStyle(rect)}
      >
        <TourNarration
          index={stepIndex}
          journey={journeyLabel(step)}
          copy={copy}
          titleId={titleId}
          bodyId={bodyId}
        />
        {startError === null ? null : <AlertLive>{startError}</AlertLive>}
        <TourFooter
          copy={copy}
          backDisabled={!held && stepIndex === 0}
          onPause={pause}
          onSkip={finish}
          onBack={goBack}
          onForward={goForward}
          pending={transitioning}
        />
      </dialog>
    </>
  )
}
