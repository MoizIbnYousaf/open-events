import { useRef, useState } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { StarIcon } from '../../../components/ui/icons'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import type {
  EvaluationAssignmentDto,
  EvaluationReviewDto,
  EvaluationRoundSummaryDto,
} from '../../../application'
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

/** "1 rating" — a count whose noun agrees with it, on a list that reaches 1 often. */
function ratingCountText(count: number): string {
  return count === 1 ? '1 rating' : `${count} ratings`
}

// The local `SubmittedReview` shape and its `isSubmittedReview` row guard are
// gone with the cast that needed them. `EvaluationReviewDto` from the
// application layer is the one definition of a review now, so the panel and the
// server cannot drift apart without the compiler saying so.

/**
 * The individual verdicts behind a round's average — the ONLY place this panel
 * reaches for them.
 *
 * The organizer summary once carried counts and a weighted average and nothing
 * else, so the committee's actual words never reached the person deciding the
 * proposal. `reviews` is now a typed field on the round summary, so this reads
 * it directly.
 *
 * It used to reach the same data through a structural cast
 * (`round as { reviews?: unknown }`) with a runtime row guard, because the
 * server half had not landed. That shape could not fail typecheck: if the
 * server renamed or dropped the field, the cast would keep compiling, the
 * guard would filter every row away, and the panel would quietly fall back to
 * the roster — showing an organizer a plausible list of reviewer names with no
 * sign that the scores and comments had been dropped. Reading the typed field
 * means that divergence is a build error instead of a silent omission.
 */
function reviewsOf(round: EvaluationRoundSummaryDto): readonly EvaluationReviewDto[] {
  return round.reviews
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
  const [chosenRound, setChosenRound] = useState('')
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
  // Only rounds that can still take reading. A closed round is a record, and
  // offering it here would invite an assignment the server refuses.
  const openRounds = (rounds.data ?? []).filter((entry) => entry.status === 'open')
  // Defaults to the live round, which is what the control did implicitly
  // before it existed — so the common case is unchanged and the other rounds
  // simply become reachable.
  const targetRound = chosenRound === '' ? (liveRound?.id ?? '') : chosenRound
  const setTargetRound = setChosenRound
  const summaryRounds = summary.data?.rounds ?? []
  const assignmentList = assignments.data ?? []
  /**
   * The committee, split by the round each person was asked in.
   *
   * The roster used to be one flat list of names printed above a separate list
   * of round results, so an organizer could read that two people were reviewing
   * and that some round averaged 4.40, with nothing on the page connecting the
   * two. Which round a rating answers is the fact that makes it usable — the
   * same proposal comes back round after round — so the people and the number
   * are now shown together, under the round they belong to.
   */
  const reviewersByRound = new Map(
    summaryRounds.map((entry) => [
      entry.roundId,
      assignmentList.filter((assignment) => assignment.roundId === entry.roundId),
    ]),
  )
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
    assign.mutate(
      { evaluatorEmail: trimmed, ...(targetRound === '' ? {} : { roundId: targetRound }) },
      { onSuccess: () => setEmail('') },
    )
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
            {/* Named, because it is not the only polite region on the
                submission page — the communications panel owns one too, and two
                unlabelled role="status" nodes are one indistinguishable pair to
                a reader moving between them (DEC-014). */}
            <StatusLive aria-label="Review round state">
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
            <h3 className={groupTitleClass}>Reviews</h3>
            {summaryRounds.length === 0 ? (
              <EmptyState
                icon={<StarIcon size={20} />}
                className="px-4 py-6"
                title="No reviews yet"
                description="Open a review round and assign an evaluator by email. Every rating they record shows up here, under the round they gave it in."
              />
            ) : (
              <ul className="-my-1 divide-y divide-border">
                {summaryRounds.map((entry) => (
                  <li key={entry.roundId} className="flex flex-col gap-1.5 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{`Round ${entry.number}: ${entry.name}`}</span>
                      {entry.status === 'closed' ? <Badge variant="outline">closed</Badge> : null}
                    </span>
                    <RoundResult round={entry} />
                    <RoundReviews
                      round={entry}
                      reviewers={reviewersByRound.get(entry.roundId) ?? []}
                    />
                    <RoundCriteria round={entry} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className={groupTitleClass}>Add an evaluator</h3>
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
              {/* WHICH round this reading belongs to. Without it every
                  assignment silently went to whichever round happened to be
                  open, so an organizer who had opened round 2 could not staff
                  round 1 at all — and was told nothing, because from the
                  outside a successful assignment looks the same either way. */}
              <Field className="min-w-40">
                <FieldLabel htmlFor="evaluation-assign-round">Round</FieldLabel>
                <NativeSelect
                  id="evaluation-assign-round"
                  value={targetRound}
                  onChange={(event) => setTargetRound(event.target.value)}
                >
                  {openRounds.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {`Round ${entry.number}: ${entry.name}`}
                    </option>
                  ))}
                </NativeSelect>
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
        </>
      )}
    </section>
  )
}

/**
 * What the committee said about this proposal in this round.
 *
 * Ratings and comment text both persisted from the day the evaluator surface
 * existed and neither was ever shown to the organizer, who was left deciding a
 * proposal from a single weighted average. There is no blind or anonymised
 * review anywhere in this product, so the reviewer is named: an unattributed
 * verdict is one the organizer cannot weigh or follow up on.
 *
 * The comment is the reviewer's own prose, so it is printed whole and wrapped
 * rather than truncated — the sentence after the one that fits is usually the
 * reason for the score. Its line breaks are the reviewer's, and they survive.
 *
 * With no verdicts to show, the round falls back to naming who it asked.
 */
function RoundReviews({
  round,
  reviewers,
}: {
  readonly round: EvaluationRoundSummaryDto
  readonly reviewers: readonly EvaluationAssignmentDto[]
}) {
  const reviews = reviewsOf(round)
  if (reviews.length === 0) return <RoundReviewers reviewers={reviewers} />
  return (
    <ul aria-label={`Reviews in round ${round.number}`} className="grid gap-2">
      {reviews.map((review) => (
        <li key={review.assignmentId} className="grid gap-0.5">
          {/* A reviewer provisioned by email may have no name yet; their
              address is the identifying fact we actually hold, and it is
              better than an empty line where a person should be. */}
          <span className="text-sm font-medium">{review.evaluatorName ?? review.evaluatorEmail}</span>
          <span className="text-xs text-muted-foreground">{review.evaluatorEmail}</span>
          <span className="text-xs text-muted-foreground">
            {review.rating === null ? 'No rating recorded yet' : `Rated ${review.rating} of 5`}
          </span>
          {review.comment === null || review.comment.length === 0 ? null : (
            <p className="text-sm whitespace-pre-wrap text-foreground">{review.comment}</p>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Who this round asked. A round with an entry in the summary but nobody on it
 * is a real state — the organizer opened it and has not staffed it yet — and it
 * says so rather than leaving the group looking truncated.
 */
function RoundReviewers({ reviewers }: { readonly reviewers: readonly EvaluationAssignmentDto[] }) {
  if (reviewers.length === 0) {
    return <span className="text-xs text-muted-foreground">No evaluator is on this round yet</span>
  }
  return (
    <ul className="grid gap-1">
      {reviewers.map((reviewer) => (
        <li key={reviewer.id} className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{reviewer.evaluatorName}</span>
          <span className="text-xs text-muted-foreground">{reviewer.evaluatorEmail}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The criteria behind the round's one number.
 *
 * A weighted average of 4.40 built from a 4.50 on relevance and a 4.00 on
 * experience describes a different proposal from one built the other way round,
 * and the organizer deciding it had only the 4.40. The breakdown was on the
 * wire from the day the summary existed and nothing rendered it. Each row says
 * how many ratings it averages, because a criterion one person answered and one
 * the whole round answered do not deserve equal weight in a reader's head.
 */
function RoundCriteria({ round }: { readonly round: EvaluationRoundSummaryDto }) {
  if (round.criteria.length === 0) return null
  return (
    <ul aria-label={`Criteria in round ${round.number}`} className="grid gap-0.5">
      {round.criteria.map((criterion) => (
        <li key={criterion.criterionId} className="text-xs text-muted-foreground">
          {criterion.scoreCount === 0
            ? `${criterion.name} (weight ${criterion.weight}) — no ratings yet`
            : `${criterion.name} (weight ${criterion.weight}) — ${averageText(
                Math.round((criterion.ratingSum * 100) / criterion.scoreCount),
              )} from ${ratingCountText(criterion.scoreCount)}`}
        </li>
      ))}
    </ul>
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
