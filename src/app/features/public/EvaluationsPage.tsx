import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { getApiErrorCode } from '../../api/admin-events'
import {
  clearEvaluationDraft,
  publicEvaluationsQueryKeys,
  readEvaluationDraft,
  recoverEvaluationSession,
  stashEvaluationDraft,
  usePublicEvaluations,
  useSubmitEvaluation,
  type EvaluationRow,
} from '../../queries/public-evaluations'
import { ExpiredSessionState, ForbiddenState } from '../admin/AdminStates'

const fieldClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none disabled:opacity-50 md:text-sm'

const RATINGS = [1, 2, 3, 4, 5] as const

export default function EvaluationsPage() {
  const query = usePublicEvaluations()
  const queryClient = useQueryClient()
  const router = useRouter({ warn: false })
  // A submitter session is short, and it expires just as readily on the POST
  // that stores a rating as on the read that listed the assignments. Both have
  // to reach the same surface, so the write's verdict is lifted here rather
  // than left as a generic banner inside one card — that also keeps a single
  // page-owned h1 in every state.
  const [writeCode, setWriteCode] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Evaluations — SpeakerOps'
  }, [])

  const code = getApiErrorCode(query.error) ?? writeCode
  if (code === 'unauthorized') {
    return <ExpiredSessionState onLogin={() => recoverEvaluationSession(queryClient, router)} />
  }
  if (code === 'forbidden') {
    return <ForbiddenState />
  }
  if (query.isError) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Evaluations</h1>
        <Card>
          <CardContent className="grid gap-3">
            <AlertLive>Unable to load evaluations.</AlertLive>
            {/* Every other error surface in this app offers a way back; this
                one used to be a dead end with nothing to press. */}
            <div>
              <Button
                type="button"
                variant="outline"
                pending={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {query.isFetching ? 'Trying again…' : 'Try again'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
  if (query.data === null) {
    // A 404 is not a failure: it means this deployment serves no evaluations
    // for this evaluator. Saying so plainly is honest; an assertive error with
    // a retry that can only 404 again would not be.
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Evaluations</h1>
        <Card>
          <CardContent>
            <StatusLive aria-live="polite">Evaluations are not open yet.</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }
  if (query.data === undefined) {
    return (
      <section aria-label="Evaluations" aria-busy={query.isPending}>
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-10 w-full" />
            <StatusLive aria-live="polite">Loading evaluations…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }
  const rows = query.data
  if (rows.length === 0) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Evaluations</h1>
        <Card>
          <CardContent>
            <StatusLive aria-live="polite">No evaluations yet.</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Evaluations</h1>
      {rows.map((row) => (
        <EvaluationCard key={row.submissionId} row={row} onAuthFailure={setWriteCode} />
      ))}
    </div>
  )
}

/**
 * One assigned submission: what this evaluator has recorded in the round they
 * are working in, what they said in the rounds before it, and the form that
 * changes it.
 *
 * The form is keyed to the row it belongs to, so an evaluator holding several
 * assignments scores the session they are looking at rather than always the
 * first one. It is seeded from the stored score, which is what makes a
 * rating-only edit safe: the justification the evaluator already wrote is on
 * screen and travels back with the rating instead of being silently dropped.
 */
function EvaluationCard({
  row,
  onAuthFailure,
}: {
  readonly row: EvaluationRow
  readonly onAuthFailure: (code: string) => void
}) {
  const queryClient = useQueryClient()
  const submit = useSubmitEvaluation()
  const scored = row.rating !== null
  // Work held over from a session that expired mid-review outranks the stored
  // row: it is the newer opinion, and it is the one the evaluator would
  // otherwise have to retype.
  const [heldOver] = useState(() => readEvaluationDraft(row.submissionId))
  const [rating, setRating] = useState<number | null>(
    heldOver === null ? row.rating : heldOver.rating,
  )
  const [comments, setComments] = useState(
    heldOver === null ? (row.comments ?? '') : heldOver.comments,
  )
  const [ratingMissing, setRatingMissing] = useState(false)
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null)
  const ratingId = `evaluation-rating-${row.submissionId}`
  const commentsId = `evaluation-comments-${row.submissionId}`
  const ratingErrorId = `${ratingId}-error`

  const handleSubmit = () => {
    if (submit.isPending) return
    if (rating === null) {
      submit.reset()
      setRatingMissing(true)
      return
    }
    setRatingMissing(false)
    setSubmittedMessage(null)
    submit.mutate(
      { submissionId: row.submissionId, rating, comments: comments.trim() },
      {
        onSuccess: () => {
          // Reset erases isSuccess, so the evaluator used to get no
          // confirmation of any kind. Hold the outcome locally instead. The
          // StatusLive that renders it is the announcement — announcing the
          // same sentence again would speak it twice (DEC-014).
          setSubmittedMessage('Evaluation submitted')
          submit.reset()
          clearEvaluationDraft(row.submissionId)
          void queryClient.invalidateQueries({ queryKey: publicEvaluationsQueryKeys.all })
        },
        onError: (error) => {
          setSubmittedMessage(null)
          const code = getApiErrorCode(error)
          if (code !== 'unauthorized' && code !== 'forbidden') return
          // The rating never reached the server, so hold it before the page
          // swaps this form out for the recovery surface.
          stashEvaluationDraft(row.submissionId, { rating, comments: comments.trim() })
          onAuthFailure(code)
        },
      },
    )
  }

  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="grid gap-1 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">{row.sessionTitle}</p>
          <p className="text-sm text-muted-foreground">
            Round {row.roundNumber}: {row.roundName}
            {row.roundStatus === 'closed' ? ' (closed)' : ''}
          </p>
          {scored ? (
            <>
              <p className="text-sm">Rating: {row.rating}</p>
              <p className="text-sm">Comments: {row.comments ?? ''}</p>
              <p className="text-sm text-muted-foreground">Updated: {row.updatedAt ?? ''}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not yet scored</p>
          )}
        </div>
        {row.previousRounds.length === 0 ? null : (
          <div className="grid gap-1 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Earlier rounds</p>
            {row.previousRounds.map((previous) => (
              <p key={previous.roundNumber} className="text-sm text-muted-foreground">
                Round {previous.roundNumber}: {previous.roundName} — rated {previous.rating}
                {previous.comments === null ? '' : ` — ${previous.comments}`}
              </p>
            ))}
          </div>
        )}
        <h2 className="text-lg font-semibold">Evaluate this session</h2>
        <div className="grid gap-1.5">
          <label htmlFor={ratingId}>Rating</label>
          <select
            id={ratingId}
            value={rating ?? ''}
            aria-invalid={ratingMissing ? true : undefined}
            aria-describedby={ratingMissing ? ratingErrorId : undefined}
            onChange={(event) => {
              const next = event.target.value
              setRating(next === '' ? null : Number(next))
              setRatingMissing(false)
            }}
            className={fieldClass}
          >
            <option value="">Select…</option>
            {RATINGS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          {ratingMissing ? <AlertLive id={ratingErrorId}>A rating is required</AlertLive> : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={commentsId}>Comments (optional)</label>
          <textarea
            id={commentsId}
            value={comments}
            onChange={(event) => setComments(event.target.value)}
            className={`${fieldClass} min-h-24 resize-y`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" pending={submit.isPending} onClick={handleSubmit}>
            {submit.isPending ? 'Submitting…' : 'Submit'}
          </Button>
          <StatusLive aria-live="polite">
            {submit.isPending ? 'Submitting your evaluation…' : submittedMessage}
          </StatusLive>
        </div>
        {submit.isError ? <AlertLive>Unable to submit your evaluation.</AlertLive> : null}
      </CardContent>
    </Card>
  )
}
