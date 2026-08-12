import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ClipboardIcon } from '../../../components/ui/icons'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { getApiErrorCode } from '../../api/admin-events'
import type { EventSlug } from '../../../domain'
import {
  useAddCommitteeMember,
  useCommittee,
  useDefineEvaluationCriteria,
  useEvaluationCriteria,
  useEvaluationRounds,
  useRemoveCommitteeMember,
  useRunEventRounds,
} from '../../queries/admin-evaluations'
import type { CommitteeRosterEntry } from '../../api/admin-evaluations'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import AppShell from '../nav/AppShell'
import { DeniedState, ExpiredSessionState, ForbiddenState } from './AdminStates'
import RoundConfirmDialog from './RoundConfirmDialog'

/**
 * The event-level half of REQ-009: the rubric the committee scores against and
 * the rounds it scores in.
 *
 * Staffing a particular submission stays on that submission's page, where the
 * organizer can see what they are staffing; what belongs here is everything
 * that is true of the event rather than of one proposal.
 */
export default function EvaluationCommitteePage() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  const criteria = useEvaluationCriteria(slug as EventSlug | undefined)
  const rounds = useEvaluationRounds(slug as EventSlug | undefined)
  // An expired session is a dead end, and a dead end is a PAGE. Rendered inside
  // the rail it was a card in a shell full of destinations the reader can no
  // longer open — the same moment wearing a different anatomy depending on
  // which organizer route reached it. Bare is what the majority render and what
  // the AdminStates grammar is drawn for. Both observers share the screen's own
  // queries, so asking one level up adds no request.
  const loadError = criteria.error ?? rounds.error
  if (loadError != null && getApiErrorCode(loadError) === 'unauthorized') {
    return <ExpiredCommitteeSession />
  }
  return (
    <AppShell slug={slug ?? ''}>
      {/* The same reading measure Event settings and Taxonomies use. This page
          is a form — a rubric editor and a rounds editor — and full-bleed it
          stretched a single-line "Criterion name" input to ~1250px, wider than
          a page of prose. C0 §3: readable column for forms, full width for
          tables and boards. */}
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <EvaluationCommitteeScreen />
      </div>
    </AppShell>
  )
}

/** Its own component so the router hook runs only when the branch renders. */
function ExpiredCommitteeSession() {
  const navigate = useNavigate()
  useEffect(() => {
    document.title = 'Session expired — SpeakerOps'
  }, [])
  return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
}

function EvaluationCommitteeScreen() {
  const params = useParams({ strict: false })
  const slug = params.slug as EventSlug | undefined
  const criteria = useEvaluationCriteria(slug)
  const rounds = useEvaluationRounds(slug)

  useEffect(() => {
    document.title = 'Review committee — SpeakerOps'
  }, [])

  const loadError = criteria.error ?? rounds.error
  if (loadError != null) {
    const code = getApiErrorCode(loadError)
    if (code === 'forbidden') return <ForbiddenState />
    if (code === 'not_found') return <DeniedState />
    // `unauthorized` never reaches here: the page answers it above the shell.
    // A committee that cannot be read is a transient server or network fault,
    // so the organizer gets something to press instead of a sentence and a
    // dead end. Refetching a read adds no write to the mutation ledger.
    const retrying = criteria.isFetching || rounds.isFetching
    return (
      <div className="grid gap-4">
        <CommitteeHeading />
        <Card>
          <CardContent className="grid justify-items-start gap-3">
            <AlertLive>The review committee could not be loaded.</AlertLive>
            <Button
              type="button"
              variant="outline"
              pending={retrying}
              onClick={() => {
                void criteria.refetch()
                void rounds.refetch()
              }}
            >
              {retrying ? 'Trying again…' : 'Try again'}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (criteria.isPending || rounds.isPending || slug === undefined) {
    return (
      <div aria-busy="true" aria-label="Loading the review committee" className="grid gap-4">
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <StatusLive>Loading the review committee…</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  // No back link: Review committee is a rail destination, so the rail is the
  // way back and says so with `aria-current`. See `BackLink.tsx`.
  // Reviewers first. The page is named for the committee, and for most of its
  // life the question is who is on it — the rubric and the rounds are what the
  // committee scores WITH, and they were the whole page while the committee
  // itself had no screen at all.
  return (
    <div className="grid gap-4">
      <CommitteeHeading />
      <ReviewersSection slug={slug} />
      <CriteriaSection slug={slug} defined={criteria.data ?? []} />
      <RoundsSection slug={slug} rounds={rounds.data ?? []} />
    </div>
  )
}

/** "1 of 3" — done over given, in the order an organizer reads it. */
function workloadText(entry: CommitteeRosterEntry): string {
  return `${entry.completedCount} of ${entry.assignedCount} reviews done`
}

/**
 * The committee itself: who is seated, what each of them owes, how somebody
 * joins, and how somebody leaves.
 *
 * This section is the whole point of the page's name. Before it existed the
 * only way to seat a reviewer was a box on ONE submission's detail, so an
 * organizer could staff a proposal but never see or manage their committee —
 * and an evaluator looking for reviewer management concluded, correctly, that
 * the product had none.
 */
function ReviewersSection({ slug }: { readonly slug: EventSlug }) {
  const roster = useCommittee(slug)
  const add = useAddCommitteeMember(slug)
  const remove = useRemoveCommitteeMember(slug)
  const [email, setEmail] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [invited, setInvited] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<CommitteeRosterEntry | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const emailErrorId = 'reviewer-email-error'

  const members = roster.data ?? []

  /**
   * Where focus goes when the control holding it stops existing.
   *
   * Removing a reviewer unmounts the row — and the Remove button inside it that
   * the confirm dialog just handed focus back to — so a keyboard reader would
   * land on <body> with the page's place lost. The section heading is always
   * mounted and is a destination rather than another action.
   */
  const landOnHeading = () => headingRef.current?.focus()

  function submitInvite(event: React.FormEvent): void {
    event.preventDefault()
    const candidate = email.trim()
    // Refused here rather than posted and refused there: an empty field is not
    // a question worth asking the server, and the answer would arrive as a
    // generic failure rather than as the specific thing that is wrong.
    if (candidate.length === 0) {
      setInvalid(true)
      // A previous failure's alert must not stand beside this one: they would
      // describe two different attempts, one of which is no longer in flight.
      add.reset()
      return
    }
    setInvalid(false)
    setInvited(null)
    // `mutate` with callbacks, not `mutateAsync`: the async form REJECTS on
    // failure, and firing it into a `void` leaves an unhandled rejection behind
    // every failed invite. The error is already rendered from `add.error`.
    add.mutate(candidate, {
      onSuccess: (seated) => {
        // The SERVER's answer, not the string that was typed: it resolves the
        // person's real name, and it says whether this was actually a new seat.
        // Announcing an invitation for somebody already seated tells the
        // organizer they did something they did not.
        setInvited(seated.created ? (seated.name.trim() || seated.email) : null)
        setEmail('')
      },
    })
  }

  return (
    <section aria-labelledby="reviewers-heading">
      <Card>
        <CardHeader>
          {/* `level` is what makes CardTitle a heading — without it the
              component renders a div, and the section this page was rebuilt
              around would be missing from the heading outline while its two
              siblings appear. It is also the landing place focus needs after a
              row is removed from under it. */}
          <CardTitle id="reviewers-heading" level={2} ref={headingRef} tabIndex={-1}>
            Reviewers
          </CardTitle>
          <CardDescription>
            Who reads proposals for this event. Adding someone here grants them access to this
            event&rsquo;s review queue and nothing else.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* The placeholder shapes carry the busy flag; the sentence does not
              repeat them. Two announcements for one load is one too many, and
              this page already has more polite regions than it should. */}
          {roster.isPending ? (
            <div aria-busy="true" aria-label="Loading the reviewers" className="grid gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : null}

          {roster.error != null ? (
            <div className="grid justify-items-start gap-2">
              <AlertLive>The reviewers could not be loaded.</AlertLive>
              <Button
                type="button"
                variant="outline"
                pending={roster.isFetching}
                onClick={() => void roster.refetch()}
              >
                {roster.isFetching ? 'Trying again…' : 'Try again'}
              </Button>
            </div>
          ) : null}

          {!roster.isPending && roster.error == null && members.length === 0 ? (
            <EmptyState
              icon={<ClipboardIcon aria-hidden />}
              title="No reviewers yet"
              description="Add someone by email to start building the review committee. They do not need an account first."
            />
          ) : null}

          {members.length > 0 ? (
            <ul className="grid gap-2" aria-label="Seated reviewers">
              {members.map((member) => (
                <li
                  key={member.contactId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="grid min-w-0">
                    <span className="truncate text-sm font-medium">{member.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {/* The workload is the reason a roster exists, so it sits
                        beside the person rather than a click away. */}
                    <Badge variant="outline">{workloadText(member)}</Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingRemoval(member)}
                    >
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <form className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(event) => void submitInvite(event)}>
            <Field>
              <FieldLabel htmlFor="reviewer-email">Reviewer email</FieldLabel>
              <Input
                id="reviewer-email"
                type="email"
                value={email}
                aria-invalid={invalid || undefined}
                // The field POINTS at its error, as the criterion field beside
                // it does. Marked invalid with nothing described, a screen
                // reader returning to the input hears "invalid entry" and no
                // reason — and the alert it would have heard is shared with two
                // other messages.
                aria-describedby={invalid ? emailErrorId : undefined}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setInvalid(false)
                }}
              />
            </Field>
            <Button type="submit" pending={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add reviewer'}
            </Button>
          </form>

          {invalid ? (
            <AlertLive id={emailErrorId}>Enter the reviewer&rsquo;s email address.</AlertLive>
          ) : null}
          {add.error != null ? (
            <AlertLive>That reviewer could not be added. Check the address and try again.</AlertLive>
          ) : null}

          {/* A provisioned reviewer may never have used the product, so the
              confirmation has to answer the question it raises: how do they get
              in? Naming the sign-in route is the difference between an invite
              and a row appearing in a list. */}
          {/* Named, because this page carries more than one polite region and
              an unnamed one is announced without saying what it is about. */}
          <StatusLive aria-label="Invite result">
            {invited === null
              ? null
              : `${invited} is on the review committee. They sign in from the home page with their email — no password, and no account needed first.`}
          </StatusLive>
        </CardContent>
        <CardFooter>
          <CardDescription>
            Assign proposals to reviewers from any submission&rsquo;s page, under Review committee.
          </CardDescription>
        </CardFooter>

        {/* The dialog stays open across the request and reports its own
            failure, per the component's contract: closing on click and
            surfacing the error at the bottom of the card reads as "removed",
            then silently is not. */}
        <ConfirmDialog
          open={pendingRemoval !== null}
          onOpenChange={(open) => setPendingRemoval(open ? pendingRemoval : null)}
          tone="destructive"
          title="Remove this reviewer"
          description={
            pendingRemoval === null
              ? ''
              : `${pendingRemoval.name || pendingRemoval.email} loses access to this event's review queue immediately, including any proposals already assigned to them. Anything they have already scored stays on record, and they keep their account.`
          }
          confirmLabel="Confirm removal"
          pending={remove.isPending}
          onConfirm={() => {
            const target = pendingRemoval
            if (target === null) return
            remove.mutate(target.contactId, {
              onSuccess: () => {
                setPendingRemoval(null)
                // The row that held focus is about to unmount underneath it.
                landOnHeading()
              },
            })
          }}
        >
          {remove.error != null ? (
            <AlertLive>
              That reviewer could not be removed. They are still on the committee.
            </AlertLive>
          ) : null}
        </ConfirmDialog>
      </Card>
    </section>
  )
}

/** One h1 for the page, identical in every state it survives into. */
function CommitteeHeading() {
  return (
    <PageHeader>
      <PageHeaderContent>
        <PageHeaderTitle>Review committee</PageHeaderTitle>
        <PageHeaderDescription>
          The rubric every rating is scored against, and the rounds it is scored in.
        </PageHeaderDescription>
      </PageHeaderContent>
    </PageHeader>
  )
}

interface DefinedCriterion {
  readonly id: string
  readonly name: string
  readonly weight: number
  readonly position: number
}

/**
 * The rubric. Weights are relative, so a criterion weighted 2 counts twice as
 * much as one weighted 1 — which is only meaningful next to the others, hence
 * the list and the form on one surface.
 */
function CriteriaSection({
  slug,
  defined,
}: {
  readonly slug: EventSlug
  readonly defined: readonly DefinedCriterion[]
}) {
  const define = useDefineEvaluationCriteria(slug)
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('1')
  const [nameMissing, setNameMissing] = useState(false)
  const nameErrorId = 'criterion-name-error'

  const handleAdd = () => {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      define.reset()
      setNameMissing(true)
      return
    }
    setNameMissing(false)
    const parsed = Number(weight)
    const safeWeight = Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1
    // The route defines the whole set, so everything already stored travels
    // back with the addition rather than being deleted by omission.
    define.mutate(
      [
        ...defined.map((criterion) => ({
          name: criterion.name,
          weight: criterion.weight,
          position: criterion.position,
        })),
        { name: trimmed, weight: safeWeight, position: defined.length },
      ],
      {
        onSuccess: () => {
          setName('')
          setWeight('1')
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>Criteria</CardTitle>
        <CardDescription>Relative weights: a criterion at 2 counts twice one at 1.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {defined.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon size={20} />}
            title="Define what the committee scores"
            description="Every rating is weighed against the criteria you add here."
          />
        ) : (
          <ul className="-my-1 divide-y divide-border">
            {defined.map((criterion) => (
              <li key={criterion.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">{criterion.name}</span>
                {/* An annotation on a criterion, not a state it is in: quiet
                    ink, and no state marker to claim otherwise. */}
                <Badge variant="ghost">{`Weight ${criterion.weight}`}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="flex-wrap items-end gap-3">
        <Field className="min-w-48 flex-1">
          <FieldLabel htmlFor="criterion-name">Criterion name</FieldLabel>
          <Input
            id="criterion-name"
            value={name}
            aria-invalid={nameMissing ? true : undefined}
            aria-describedby={nameMissing ? nameErrorId : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setNameMissing(false)
            }}
          />
        </Field>
        <Field className="w-24">
          <FieldLabel htmlFor="criterion-weight">Weight</FieldLabel>
          <Input
            id="criterion-weight"
            type="number"
            min={1}
            step={1}
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </Field>
        <Button type="button" pending={define.isPending} onClick={handleAdd}>
          Add criterion
        </Button>
        {nameMissing ? (
          <AlertLive id={nameErrorId} className="w-full">
            A criterion name is required
          </AlertLive>
        ) : null}
        {define.isError ? (
          <AlertLive className="w-full">That criterion could not be saved.</AlertLive>
        ) : null}
      </CardFooter>
    </Card>
  )
}

interface ListedRound {
  readonly id: string
  readonly number: number
  readonly name: string
  readonly status: 'open' | 'closed'
}

/** The rounds, and the two moves an organizer can make on them. */
function RoundsSection({
  slug,
  rounds,
}: {
  readonly slug: EventSlug
  readonly rounds: readonly ListedRound[]
}) {
  const run = useRunEventRounds(slug)
  const [confirmRound, setConfirmRound] = useState<'open' | 'close' | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  /**
   * Closing the open round removes "Close round N" and opening one renumbers
   * it, so the confirm dialog hands focus back to a trigger that is no longer
   * there and it lands on <body>. The card's own heading is always mounted and
   * is a landing place rather than another action.
   */
  const landOnHeading = () => headingRef.current?.focus()
  const liveRound = rounds.filter((round) => round.status === 'open').at(-1) ?? null
  const nextNumber = rounds.reduce((best, round) => Math.max(best, round.number), 0) + 1

  return (
    <Card>
      <CardHeader>
        <CardTitle level={2} ref={headingRef} tabIndex={-1} className="outline-hidden">
          Review rounds
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {/* Named, like the invite region above it. This one is never empty, so
            on a page carrying more than one polite region an unnamed instance
            is announced without saying what it is about (DEC-014), and the
            submission page labels its twin for the same reason. */}
        <StatusLive aria-label="Review round state">
          {liveRound === null ? 'No review round is open.' : `Round ${liveRound.number} is open.`}
        </StatusLive>
        {rounds.length === 0 ? null : (
          <ul className="-my-1 divide-y divide-border">
            {rounds.map((round) => (
              <li key={round.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {`Round ${round.number}: ${round.name}`}
                </span>
                {/* A round's status is a lifecycle state, so the chip carries
                    the state marker — and while a close is actually in the
                    air, that marker is the thing that says so. Only the open
                    round is moving: opening a round creates a new one, and no
                    chip on screen is waiting on that. The LABEL does not
                    change while the wait lasts; it is still the state the
                    server last confirmed, and it stays true until the server
                    says otherwise. The animation is silent by design — this
                    card already owns the page's live region, and a second
                    voice announcing the same wait is not an improvement. */}
                <Badge
                  variant={round.status === 'closed' ? 'outline' : 'secondary'}
                  dot
                  pending={run.close.isPending && round.id === liveRound?.id}
                >
                  {round.status === 'closed' ? 'Closed' : 'Open'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {run.open.isError || run.close.isError ? (
          <AlertLive>That review round could not be changed.</AlertLive>
        ) : null}
      </CardContent>
      <CardFooter className="flex-wrap gap-3">
        {liveRound === null ? null : (
          <Button
            type="button"
            variant="outline"
            pending={run.close.isPending}
            onClick={() => setConfirmRound('close')}
          >
            {`Close round ${liveRound.number}`}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          pending={run.open.isPending}
          onClick={() => setConfirmRound('open')}
        >
          {`Open round ${nextNumber}`}
        </Button>
        {/* Same two questions the submission-level panel asks, from the same
            module: closing is one-way, and opening moves what the committee
            is scoring. */}
        {liveRound === null ? null : (
          <RoundConfirmDialog
            open={confirmRound === 'close'}
            onOpenChange={(next) => {
              if (!next) setConfirmRound(null)
            }}
            kind="close"
            number={liveRound.number}
            pending={run.close.isPending}
            failed={run.close.isError}
            onConfirm={() =>
              run.close.mutate(liveRound.id, {
                onSuccess: () => {
                  setConfirmRound(null)
                  landOnHeading()
                },
              })
            }
          />
        )}
        <RoundConfirmDialog
          open={confirmRound === 'open'}
          onOpenChange={(next) => {
            if (!next) setConfirmRound(null)
          }}
          kind="open"
          number={nextNumber}
          pending={run.open.isPending}
          failed={run.open.isError}
          onConfirm={() =>
            run.open.mutate(
              { number: nextNumber, name: `Round ${nextNumber}` },
              {
                onSuccess: () => {
                  setConfirmRound(null)
                  landOnHeading()
                },
              },
            )
          }
        />
      </CardFooter>
    </Card>
  )
}
