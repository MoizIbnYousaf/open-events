import { useRef, useState } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { StarIcon } from '../../../components/ui/icons'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import type { EvaluationRoundSummaryDto } from '../../../application'
import type { EventSlug, SubmissionId } from '../../../domain'
import { getApiErrorCode } from '../../api/admin-events'
import {
  useAssignEvaluator,
  useEvaluationAssignments,
  useEvaluationRounds,
  useEvaluationSummary,
  useRunEvaluationRound,
} from '../../queries/admin-evaluations'
import RoundConfirmDialog from './RoundConfirmDialog'

interface EvaluationPanelProps {
  readonly slug: EventSlug
  readonly submissionId: SubmissionId
}

/** The panel's own sub-headings: one step below the card title, same weight. */
const groupTitleClass = 'text-sm font-medium'

/**
 * Why an assignment was refused, and what to do about it.
 *
 * The panel used to answer every refusal with "That evaluator could not be
 * assigned." — a sentence that names no cause and offers no way forward, on
 * the one control whose most likely failure has a precondition the organizer
 * cannot guess. Assignment resolves the email to an EXISTING identity and
 * never creates one, so the ordinary refusal is an address nobody has signed
 * in with yet; the second is an event with no open round to assign into.
 *
 * The server's own words never reach the page — only its code is read, and the
 * sentence is the product's.
 */
function assignmentRefusal(error: unknown): string {
  switch (getApiErrorCode(error)) {
    case 'not_found':
      return 'No one has signed in with that email yet, and assigning does not create an identity. Ask them to request a sign-in link from the speaker start page, then assign them again.'
    case 'conflict':
      return 'This event has no open review round, so there is nothing to assign into. Open a round above, then assign them again.'
    case 'validation_failed':
      return 'That is not an email address the committee can be reached at. Check it and try again.'
    default:
      return 'That evaluator could not be assigned.'
  }
}

/** A weighted average in hundredths of a point, as organizers read it. */
function averageText(centis: number): string {
  return (centis / 100).toFixed(2)
}

/**
 * Organizer review-committee panel: who is reviewing this submission, which
 * round they are reviewing it in, and what every round concluded.
 *
 * A round that recorded nothing says so rather than showing 0.00, and a round
 * that finished keeps reporting its own result beside the live one — the
 * organizer never has to take a single unlabelled number on trust.
 */
export default function EvaluationPanel({ slug, submissionId }: EvaluationPanelProps) {
  const rounds = useEvaluationRounds(slug)
  const assignments = useEvaluationAssignments(slug, submissionId)
  const summary = useEvaluationSummary(slug, submissionId)
  const assign = useAssignEvaluator(slug, submissionId)
  const round = useRunEvaluationRound(slug, submissionId)
  const [email, setEmail] = useState('')
  const [emailMissing, setEmailMissing] = useState(false)
  const [confirmRound, setConfirmRound] = useState<'open' | 'close' | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  /**
   * Where focus lands when the control that had it is about to stop existing.
   *
   * Closing the open round removes the "Close round N" button; opening one adds
   * it and renumbers the other. The reader pressed a control inside a confirm
   * dialog, the dialog closed, and Base UI handed focus back to a trigger that
   * had been replaced — so it went to <body> and a keyboard reader lost the
   * page. The heading is always mounted and is a landing place, not another
   * action: the TasksPanel choreography, applied to the same class of moment.
   */
  const landOnHeading = () => headingRef.current?.focus()

  const isLoading = rounds.isPending || assignments.isPending || summary.isPending
  const loadError = rounds.error ?? assignments.error ?? summary.error
  const isRetrying = rounds.isFetching || assignments.isFetching || summary.isFetching
  const liveRound = (rounds.data ?? []).filter((entry) => entry.status === 'open').at(-1) ?? null
  const highestNumber = (rounds.data ?? []).reduce((best, entry) => Math.max(best, entry.number), 0)
  const nextNumber = highestNumber + 1

  const handleAssign = () => {
    const trimmed = email.trim()
    if (trimmed.length === 0) {
      assign.reset()
      setEmailMissing(true)
      return
    }
    setEmailMissing(false)
    assign.mutate(trimmed, { onSuccess: () => setEmail('') })
  }

  const handleRetry = () => {
    void rounds.refetch()
    void assignments.refetch()
    void summary.refetch()
  }

  return (
    <section aria-labelledby="evaluation-committee-heading" className="flex flex-col gap-4">
      <CardTitle
        level={2}
        id="evaluation-committee-heading"
        ref={headingRef}
        tabIndex={-1}
        className="outline-hidden"
      >
        Review committee
      </CardTitle>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {/* aria-busy covers the placeholder shapes ONLY. It tells assistive
              tech to hold off on the subtree it marks, which silences any live
              region inside it — so the one sentence that is supposed to be
              spoken while the panel loads sits outside the busy block, and
              declares its politeness where the reader of this file can see it
              (shadscan/status-messages-announced). */}
          <div aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <StatusLive aria-live="polite">Loading the review committee…</StatusLive>
        </div>
      ) : loadError !== null ? (
        // The panel used to end here with a sentence and nothing to press. It
        // sits inside a page that owns the h1, so it retries in place rather
        // than borrowing a full-page error state.
        <div className="flex flex-col items-start gap-3">
          <AlertLive>The review committee could not be loaded.</AlertLive>
          <Button type="button" variant="outline" pending={isRetrying} onClick={handleRetry}>
            {isRetrying ? 'Trying again…' : 'Try again'}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className={groupTitleClass}>Review rounds</h3>
            <StatusLive>
              {liveRound === null
                ? 'No review round is open.'
                : `Round ${liveRound.number} is open.`}
            </StatusLive>
            {/* One control height in the rail: these two sat at 28px beside
                the 32px acceptance and assignment buttons a few centimetres
                away, on the same column of the same page. */}
            <div className="flex flex-wrap items-center gap-2">
              {liveRound === null ? null : (
                <Button
                  type="button"
                  variant="outline"
                  pending={round.close.isPending}
                  onClick={() => setConfirmRound('close')}
                >
                  {round.close.isPending ? 'Closing round…' : `Close round ${liveRound.number}`}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                pending={round.open.isPending}
                onClick={() => setConfirmRound('open')}
              >
                {round.open.isPending ? 'Opening round…' : `Open round ${nextNumber}`}
              </Button>
            </div>
            {/* Closing is one-way and opening changes what every evaluator is
                scoring, so both ask first — with the same words the event-level
                committee page asks them. */}
            {liveRound === null ? null : (
              <RoundConfirmDialog
                open={confirmRound === 'close'}
                onOpenChange={(next) => {
                  if (!next) setConfirmRound(null)
                }}
                kind="close"
                number={liveRound.number}
                pending={round.close.isPending}
                failed={round.close.isError}
                onConfirm={() =>
                  round.close.mutate(liveRound.id, {
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
              pending={round.open.isPending}
              failed={round.open.isError}
              onConfirm={() =>
                round.open.mutate(
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
            <StatusLive className="sr-only">
              {round.close.isPending
                ? 'Closing the review round…'
                : round.open.isPending
                  ? 'Opening the review round…'
                  : null}
            </StatusLive>
            {round.open.isError || round.close.isError ? (
              <AlertLive>That review round could not be changed.</AlertLive>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className={groupTitleClass}>Evaluators on this submission</h3>
            {(assignments.data ?? []).length === 0 ? (
              <EmptyState
                icon={<StarIcon size={20} />}
                className="px-4 py-6"
                title="Staff this proposal"
                description="Assign an evaluator by email and they will see it in their queue."
              />
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {(assignments.data ?? []).map((assignment) => (
                  <li key={assignment.id} className="flex flex-col gap-0.5 py-2">
                    <span className="font-medium">{assignment.evaluatorName}</span>
                    <span className="text-xs text-muted-foreground">
                      {assignment.evaluatorEmail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <Field className="min-w-48 flex-1">
                <FieldLabel htmlFor="evaluation-assign-email">Evaluator email</FieldLabel>
                <Input
                  id="evaluation-assign-email"
                  type="email"
                  autoComplete="section-evaluator email"
                  value={email}
                  aria-invalid={emailMissing ? true : undefined}
                  aria-describedby={emailMissing ? 'evaluation-assign-email-error' : undefined}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setEmailMissing(false)
                  }}
                />
              </Field>
              <Button type="button" pending={assign.isPending} onClick={handleAssign}>
                {assign.isPending ? 'Assigning evaluator…' : 'Assign evaluator'}
              </Button>
            </div>
            {emailMissing ? (
              <AlertLive id="evaluation-assign-email-error">
                An evaluator email is required
              </AlertLive>
            ) : null}
            <StatusLive className="sr-only">
              {assign.isPending ? 'Assigning the evaluator…' : null}
            </StatusLive>
            {assign.isError ? <AlertLive>{assignmentRefusal(assign.error)}</AlertLive> : null}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className={groupTitleClass}>Result by round</h3>
            {(summary.data?.rounds ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No review round has run yet.</p>
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {(summary.data?.rounds ?? []).map((entry) => (
                  <li key={entry.roundId} className="flex flex-col gap-0.5 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{`Round ${entry.number}: ${entry.name}`}</span>
                      {entry.status === 'closed' ? <Badge variant="outline">closed</Badge> : null}
                    </span>
                    <RoundResult round={entry} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function RoundResult({ round }: { readonly round: EvaluationRoundSummaryDto }) {
  if (round.scoreCount === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {`${round.assignmentCount} assigned — no ratings recorded yet`}
      </span>
    )
  }
  return (
    <span className="text-xs text-muted-foreground">
      {`${round.scoredCount} of ${round.assignmentCount} scored — weighted average ${averageText(
        round.weightedAverageCentis,
      )}`}
    </span>
  )
}
