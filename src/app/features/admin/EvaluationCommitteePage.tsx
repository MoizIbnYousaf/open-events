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
  useDefineEvaluationCriteria,
  useEvaluationCriteria,
  useEvaluationRounds,
  useRunEventRounds,
} from '../../queries/admin-evaluations'
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
  return (
    <div className="grid gap-4">
      <CommitteeHeading />
      <CriteriaSection slug={slug} defined={criteria.data ?? []} />
      <RoundsSection slug={slug} rounds={rounds.data ?? []} />
    </div>
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
        <StatusLive>
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
