import type { ReactNode } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { buttonVariants } from '../../../components/ui/button-variants'
import { Card, CardContent } from '../../../components/ui/card'
import { Kbd } from '../../../components/ui/kbd'
import { PaperStack } from '../../../components/ui/paper-stack'

/**
 * The one page-state recipe: a centered column of illustration → title →
 * explanation → at most one action, inside a resting card. Every organizer and
 * speaker surface that cannot render its content reaches for one of the four
 * flavours below, so a forbidden page, an expired session and a failed load all
 * read as the same kind of moment rather than three different products.
 *
 * The four exported flavours are thin configurations of `StateCard`; their
 * names, props and copy are fixed contracts consumed across the app. A surface
 * whose moment needs its own words composes `PageState` rather than inventing
 * a fifth anatomy.
 *
 * The full-page flavours are DEAD ENDS, and C0 §8 says a dead end has to be
 * closed: a reader who reaches one from the product's own links needs a way out
 * of it. So each one carries the same three things the router's 404 card
 * carries — the illustration, exactly one way forward, and the palette hint —
 * rather than being a title and a sentence in a box with nothing to press.
 *
 * The way out is a plain anchor, not a router `Link`: this module is rendered
 * by organizer routes, public routes and out-of-router test harnesses alike,
 * and a recovery surface that needs a router context to render is a recovery
 * surface that fails exactly when things have gone wrong. A full load back to
 * the start is also the more honest reset after a permission or session fault.
 */

/** Full-page states centre their CARD; LoadErrorState stays inline where it renders. */
const pageStateClass = 'mx-auto w-full max-w-md px-4 py-16'

function StateCard({
  title,
  message,
  action,
  illustrated = false,
  hint,
}: {
  readonly title: string
  /** Rendered into the card's single live region, so it is spoken once. */
  readonly message: string
  readonly action?: ReactNode
  /** Full-page states are illustrated; the inline load error is not. */
  readonly illustrated?: boolean
  readonly hint?: ReactNode
}) {
  return (
    <Card className="py-6">
      {/* RAGGED-LEFT, like the router's 404 and the crash cards. These four
          were centred while the two states next door — reached by the same
          reader, in the same session, for the same class of fault — were
          left-aligned, so one moment wore two typographic grammars depending on
          which fault caused it. Left is the one that holds: a centred paragraph
          re-centres its own ragged edge on every line, and these cards carry
          sentences rather than slogans. */}
      <CardContent className="grid max-w-sm justify-items-start gap-3">
        {illustrated ? <PaperStack /> : null}
        <h1 className="font-heading text-xl leading-tight font-semibold">{title}</h1>
        {/* The severity is carried by the title and the layout, so the message
            drops the error rule that only makes sense beside a form control
            and stays a quiet explanatory line. */}
        <AlertLive className="border-l-0 pl-0 text-sm text-pretty text-muted-foreground">
          {message}
        </AlertLive>
        {action !== undefined ? <div>{action}</div> : null}
        {hint !== undefined ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/**
 * The recipe itself, for a surface whose moment is real but whose words belong
 * with the surface rather than in this module's fixed set — the call for
 * papers refusing a save has two of those. Exported so those pages get the one
 * page-state anatomy (and the one h1) instead of hand-rolling a fifth.
 */
export function PageState({
  title,
  message,
  action,
  hint,
}: {
  readonly title: string
  readonly message: string
  readonly action?: ReactNode
  readonly hint?: ReactNode
}) {
  return (
    <div className={pageStateClass}>
      <StateCard title={title} message={message} illustrated={true} action={action} hint={hint} />
    </div>
  )
}

/**
 * The accelerator, named in a sentence rather than decorating a control — so
 * the cap has to be announced, unlike every other `Kbd` in the product.
 */
export function PaletteHint() {
  return (
    <>
      Or press <Kbd aria-hidden={false}>⌘K</Kbd> to search every screen by name.
    </>
  )
}

/**
 * One way forward, identical on every dead end so it is learned once — and at
 * the same weight as `ExpiredSessionState`'s "Sign in again" beside it, which
 * is a filled Button. Three of these four states offered their only action as
 * a quiet text link while the fourth offered a primary control, so the same
 * moment wore two different grammars depending on which fault caused it.
 *
 * A link wearing the button recipe, not a Button rendering a link: this is a
 * navigation, and going through the primitive would merge button semantics
 * onto the anchor and announce a destination as an action.
 */
function StartLink() {
  return (
    <a href="/" className={buttonVariants()}>
      Go to the start
    </a>
  )
}

export function ForbiddenState() {
  return (
    <div className={pageStateClass}>
      <StateCard
        title="Access forbidden"
        message="You do not have permission to view this page."
        illustrated={true}
        action={<StartLink />}
        hint={<PaletteHint />}
      />
    </div>
  )
}

/**
 * A purpose-bound public surface can distinguish a valid session carrying the
 * wrong capability from a missing/expired session. The recovery is not the
 * anonymous CFP form: only the organizer can issue a link after proving the
 * recipient's accepted-speaker or committee role.
 */
export function RoleLinkRequiredState({ role }: { readonly role: 'portal' | 'evaluation' }) {
  const reviewer = role === 'evaluation'
  return (
    <div className={pageStateClass}>
      <StateCard
        title={reviewer ? 'Reviewer link required' : 'Speaker portal link required'}
        message={
          reviewer
            ? 'This session does not have reviewer access. Ask the event organizer to issue a fresh reviewer invitation.'
            : 'This session does not have speaker portal access. Ask the event organizer to issue a fresh speaker portal invitation.'
        }
        illustrated={true}
        action={
          <a href={`/start?access=${role}`} className={buttonVariants()}>
            View recovery instructions
          </a>
        }
        hint={<PaletteHint />}
      />
    </div>
  )
}

export function DeniedState() {
  return (
    <div className={pageStateClass}>
      <StateCard
        title="Not found"
        message="This page could not be found."
        illustrated={true}
        action={<StartLink />}
        hint={<PaletteHint />}
      />
    </div>
  )
}

export function ExpiredSessionState({ onLogin }: { readonly onLogin: () => void }) {
  return (
    <div className={pageStateClass}>
      <StateCard
        title="Session expired"
        message="Your session has expired. Sign in again to continue."
        illustrated={true}
        action={<Button onClick={onLogin}>Sign in again</Button>}
        hint={<PaletteHint />}
      />
    </div>
  )
}

export function LoadErrorState({
  message,
  pending = false,
  onRetry,
}: {
  readonly message: string
  /** True while the retry it triggers is in flight, so the control says so. */
  readonly pending?: boolean
  readonly onRetry: () => void
}) {
  return (
    <StateCard
      title="Something went wrong"
      message={message}
      action={
        <Button variant="outline" pending={pending} onClick={onRetry}>
          {pending ? 'Trying again…' : 'Retry'}
        </Button>
      }
    />
  )
}
