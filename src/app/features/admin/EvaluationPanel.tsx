import { useState } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { StatusLive } from '../../../components/ui/status-live'
import type { EvaluationRoundSummaryDto } from '../../../application'
import type { EventSlug, SubmissionId } from '../../../domain'
import {
  useAssignEvaluator,
  useEvaluationAssignments,
  useEvaluationRounds,
  useEvaluationSummary,
  useRunEvaluationRound,
} from '../../queries/admin-evaluations'

const fieldClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none disabled:opacity-50 md:text-sm'

interface EvaluationPanelProps {
  readonly slug: EventSlug
  readonly submissionId: SubmissionId
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

  const isLoading = rounds.isPending || assignments.isPending || summary.isPending
  const loadError = rounds.error ?? assignments.error ?? summary.error
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

  return (
    <section aria-labelledby="evaluation-committee-heading" className="flex flex-col gap-4">
      <h2 id="evaluation-committee-heading" className="text-base font-semibold">
        Review committee
      </h2>

      {isLoading ? (
        <StatusLive aria-live="polite" aria-busy="true">
          Loading the review committee…
        </StatusLive>
      ) : loadError !== null ? (
        <AlertLive>The review committee could not be loaded.</AlertLive>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Review rounds</h3>
            <StatusLive aria-live="polite">
              {liveRound === null
                ? 'No review round is open.'
                : `Round ${liveRound.number} is open.`}
            </StatusLive>
            <div className="flex flex-wrap items-center gap-3">
              {liveRound === null ? null : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={round.close.isPending}
                  onClick={() => round.close.mutate(liveRound.id)}
                >
                  {round.close.isPending ? 'Closing round…' : `Close round ${liveRound.number}`}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={round.open.isPending}
                onClick={() =>
                  round.open.mutate({ number: nextNumber, name: `Round ${nextNumber}` })
                }
              >
                {round.open.isPending ? 'Opening round…' : `Open round ${nextNumber}`}
              </Button>
            </div>
            <StatusLive aria-live="polite" className="sr-only">
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
            <h3 className="text-sm font-semibold">Evaluators on this submission</h3>
            {(assignments.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody is assigned to review this submission yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {(assignments.data ?? []).map((assignment) => (
                  <li key={assignment.id} className="flex flex-col gap-0.5">
                    <span className="font-medium">{assignment.evaluatorName}</span>
                    <span className="text-muted-foreground">{assignment.evaluatorEmail}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-1.5">
              <label htmlFor="evaluation-assign-email">Evaluator email</label>
              <input
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
                className={fieldClass}
              />
              {emailMissing ? (
                <AlertLive id="evaluation-assign-email-error">
                  An evaluator email is required
                </AlertLive>
              ) : null}
            </div>
            <div>
              <Button type="button" disabled={assign.isPending} onClick={handleAssign}>
                {assign.isPending ? 'Assigning evaluator…' : 'Assign evaluator'}
              </Button>
            </div>
            <StatusLive aria-live="polite" className="sr-only">
              {assign.isPending ? 'Assigning the evaluator…' : null}
            </StatusLive>
            {assign.isError ? <AlertLive>That evaluator could not be assigned.</AlertLive> : null}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Result by round</h3>
            {(summary.data?.rounds ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No review round has run yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {(summary.data?.rounds ?? []).map((entry) => (
                  <li key={entry.roundId} className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {`Round ${entry.number}: ${entry.name}`}
                      {entry.status === 'closed' ? ' (closed)' : ''}
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
      <span className="text-muted-foreground">
        {`${round.assignmentCount} assigned — no ratings recorded yet`}
      </span>
    )
  }
  return (
    <span className="text-muted-foreground">
      {`${round.scoredCount} of ${round.assignmentCount} scored — weighted average ${averageText(
        round.weightedAverageCentis,
      )}`}
    </span>
  )
}
