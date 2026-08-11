import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
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

const fieldClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none disabled:opacity-50 md:text-sm'

const linkClass = 'text-sm font-medium text-primary underline-offset-4 hover:underline'

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
  return (
    <AppShell slug={slug ?? ''}>
      <div className="grid gap-4">
        <EvaluationCommitteeScreen />
      </div>
    </AppShell>
  )
}

function EvaluationCommitteeScreen() {
  const params = useParams({ strict: false })
  const slug = params.slug as EventSlug | undefined
  const navigate = useNavigate()
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
    if (code === 'unauthorized') {
      return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
    }
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Review committee</h1>
        <Card>
          <CardContent className="grid gap-3">
            <AlertLive>The review committee could not be loaded.</AlertLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (criteria.isPending || rounds.isPending || slug === undefined) {
    return (
      <Card aria-busy="true" aria-label="Loading the review committee">
        <CardContent className="grid gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
          <StatusLive aria-live="polite">Loading the review committee…</StatusLive>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Review committee</h1>
      <CriteriaSection slug={slug} defined={criteria.data ?? []} />
      <RoundsSection slug={slug} rounds={rounds.data ?? []} />
      <Link to="/admin/events/$slug" params={{ slug }} className={linkClass}>
        Back to event settings
      </Link>
    </div>
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
      <CardContent className="grid gap-3">
        <h2 className="text-base font-semibold">Criteria</h2>
        {defined.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No criteria yet. Every rating is scored against the criteria you define here.
          </p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {defined.map((criterion) => (
              <li key={criterion.id} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{criterion.name}</span>
                <span className="text-muted-foreground">{`Weight ${criterion.weight}`}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-1.5">
          <label htmlFor="criterion-name">Criterion name</label>
          <input
            id="criterion-name"
            value={name}
            aria-invalid={nameMissing ? true : undefined}
            aria-describedby={nameMissing ? nameErrorId : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setNameMissing(false)
            }}
            className={fieldClass}
          />
          {nameMissing ? (
            <AlertLive id={nameErrorId}>A criterion name is required</AlertLive>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="criterion-weight">Weight</label>
          <input
            id="criterion-weight"
            type="number"
            min={1}
            step={1}
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <Button type="button" disabled={define.isPending} onClick={handleAdd}>
            Add criterion
          </Button>
        </div>
        {define.isError ? <AlertLive>That criterion could not be saved.</AlertLive> : null}
      </CardContent>
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
  const liveRound = rounds.filter((round) => round.status === 'open').at(-1) ?? null
  const nextNumber = rounds.reduce((best, round) => Math.max(best, round.number), 0) + 1

  return (
    <Card>
      <CardContent className="grid gap-3">
        <h2 className="text-base font-semibold">Review rounds</h2>
        <StatusLive aria-live="polite">
          {liveRound === null ? 'No review round is open.' : `Round ${liveRound.number} is open.`}
        </StatusLive>
        {rounds.length === 0 ? null : (
          <ul className="grid gap-2 text-sm">
            {rounds.map((round) => (
              <li key={round.id} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{`Round ${round.number}: ${round.name}`}</span>
                <span className="text-muted-foreground">
                  {round.status === 'closed' ? 'Closed' : 'Open'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {liveRound === null ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={run.close.isPending}
              onClick={() => run.close.mutate(liveRound.id)}
            >
              {`Close round ${liveRound.number}`}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={run.open.isPending}
            onClick={() => run.open.mutate({ number: nextNumber, name: `Round ${nextNumber}` })}
          >
            {`Open round ${nextNumber}`}
          </Button>
        </div>
        {run.open.isError || run.close.isError ? (
          <AlertLive>That review round could not be changed.</AlertLive>
        ) : null}
      </CardContent>
    </Card>
  )
}
