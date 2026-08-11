import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card'
import { Field, FieldLabel } from '../../../components/ui/field'
import { NativeSelect } from '../../../components/ui/native-select'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import { Skeleton } from '../../../components/ui/skeleton'
import { EmptyState } from '../../../components/ui/empty-state'
import { InboxIcon } from '../../../components/ui/icons'
import { StatusLive } from '../../../components/ui/status-live'
import { Textarea } from '../../../components/ui/textarea'
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

const RATINGS = [1, 2, 3, 4, 5] as const

/**
 * An instant a person can read. The wire carries ISO-8601, which is a fact
 * about machines, and a row that prints it makes the reader parse a `T` and a
 * `Z` to answer "when did I say that".
 *
 * Fixed to UTC rather than the reader's zone on purpose: two evaluators
 * comparing notes on the same round have to be reading the same clock, and the
 * ISO instant stays on the element's `dateTime` for anything that wants to do
 * the conversion properly. A string that will not parse is handed back
 * untouched — a visibly odd timestamp is recoverable, and "Invalid Date" is
 * not.
 *
 * Module scope, because `Intl.DateTimeFormat` is expensive to construct and
 * this one is built once for every row that will ever render. The file is a
 * lazy route component, so nothing here reaches the entry chunk.
 */
const recordedAtFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatRecordedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : recordedAtFormatter.format(date)
}

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
        <EvaluationsHeading />
        <Card>
          <CardContent className="grid justify-items-start gap-3">
            <AlertLive>Unable to load evaluations.</AlertLive>
            {/* Every other error surface in this app offers a way back; this
                one used to be a dead end with nothing to press. */}
            <Button
              type="button"
              variant="outline"
              pending={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? 'Trying again…' : 'Try again'}
            </Button>
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
        <EvaluationsHeading />
        <EmptyState
          icon={<InboxIcon size={20} />}
          title={<StatusLive>Evaluations are not open yet.</StatusLive>}
          description="This event has no review round taking ratings, so the committee has nothing to score."
        />
      </div>
    )
  }
  if (query.data === undefined) {
    return (
      <section aria-label="Evaluations" aria-busy={query.isPending} className="grid gap-4">
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
            <StatusLive>Loading evaluations…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }
  const rows = query.data
  if (rows.length === 0) {
    return (
      <div className="grid gap-4">
        <EvaluationsHeading />
        <EmptyState
          icon={<InboxIcon size={20} />}
          title={<StatusLive>No evaluations yet.</StatusLive>}
          description="Proposals appear here when an organizer assigns one to you in an open review round."
        />
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <EvaluationsHeading count={rows.length} />
      {rows.map((row) => (
        <EvaluationCard key={row.submissionId} row={row} onAuthFailure={setWriteCode} />
      ))}
    </div>
  )
}

/**
 * The page's only h1. Its accessible name stays exactly "Evaluations" in every
 * state — the count that follows it is a separate line, not part of the title.
 */
function EvaluationsHeading({ count }: { readonly count?: number }) {
  return (
    <PageHeader>
      <PageHeaderContent>
        <PageHeaderTitle>Evaluations</PageHeaderTitle>
        <PageHeaderDescription>
          {count === undefined
            ? 'Sessions assigned to you to review.'
            : count === 1
              ? '1 session assigned to you to review.'
              : `${count} sessions assigned to you to review.`}
        </PageHeaderDescription>
      </PageHeaderContent>
    </PageHeader>
  )
}

/**
 * One label/value pair of the stored score, on the definition-list rhythm.
 *
 * The value is a node rather than a string because one of these rows is a
 * timestamp, and a timestamp has to carry its machine form on a `<time>`
 * element beside the words a person reads.
 */
function SummaryRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] gap-3 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{value}</dd>
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
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="min-w-0 flex-1">{row.sessionTitle}</CardTitle>
          {/* Open or closed is the round's lifecycle state, and it decides
              whether anything below this header can still be changed. */}
          <Badge dot variant={row.roundStatus === 'closed' ? 'outline' : 'secondary'}>
            {`Round ${row.roundNumber}: ${row.roundName}${
              row.roundStatus === 'closed' ? ' (closed)' : ''
            }`}
          </Badge>
        </div>
        {scored ? (
          <dl className="divide-y divide-border">
            <SummaryRow label="Rating" value={String(row.rating)} />
            <SummaryRow label="Comments" value={row.comments ?? ''} />
            {/* The same treatment the earlier-rounds list below already gives
                an instant: words for the reader, the ISO value on `dateTime`
                for anything that has to compute with it. This row was printing
                the wire's timestamp verbatim — a `T`, a fractional second and
                a `Z` — to the evaluator who had just written the score. */}
            <SummaryRow
              label="Updated"
              value={
                row.updatedAt === null ? (
                  ''
                ) : (
                  <time dateTime={row.updatedAt}>{formatRecordedAt(row.updatedAt)}</time>
                )
              }
            />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Not yet scored</p>
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        {row.previousRounds.length === 0 ? null : (
          /* Two inks, and a time hard right.
           *
           * Each earlier round used to be one run-on muted sentence — round,
           * name, rating and the whole untruncated comment chained by em
           * dashes at a single ink — so the facts an evaluator scans for had
           * no more weight than the punctuation between them, and a long
           * comment pushed the score out of reach. Which round and what score
           * is the scannable half and takes the reading ink; the comment is
           * the reading half and stays quiet below it.
           *
           * The time on the right is `updatedAt`, which this page has been
           * fetching and discarding since it was written: an evaluator
           * re-scoring in round three could not see when they recorded round
           * one. It WRAPS on a narrow screen rather than disappearing — this
           * is audit content, and hiding it below a breakpoint would leave the
           * phone and the desktop announcing two different rows. */
          <div className="grid gap-1 rounded-md border border-border p-2.5">
            <p className="text-xs font-medium text-muted-foreground">Earlier rounds</p>
            <ul className="grid gap-2">
              {row.previousRounds.map((previous) => (
                <li key={previous.roundNumber} className="grid gap-0.5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="min-w-0 font-medium text-foreground">
                      Round {previous.roundNumber}: {previous.roundName} — rated {previous.rating}
                    </span>
                    <time dateTime={previous.updatedAt} className="text-xs text-muted-foreground">
                      {formatRecordedAt(previous.updatedAt)}
                    </time>
                  </div>
                  {previous.comments === null ? null : (
                    <p className="text-muted-foreground">{previous.comments}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <CardTitle level={2}>Evaluate this session</CardTitle>
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr] sm:items-start">
          <Field>
            <FieldLabel htmlFor={ratingId}>Rating</FieldLabel>
            {/* A native `<select>` rather than the Select primitive: the
                rating is one of five integers, and a native control is the one
                every assistive technology and every mobile keyboard already
                knows. */}
            <NativeSelect
              id={ratingId}
              value={rating ?? ''}
              aria-invalid={ratingMissing ? true : undefined}
              aria-describedby={ratingMissing ? ratingErrorId : undefined}
              onChange={(event) => {
                const next = event.target.value
                setRating(next === '' ? null : Number(next))
                setRatingMissing(false)
              }}
            >
              <option value="">Select…</option>
              {RATINGS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={commentsId}>Comments (optional)</FieldLabel>
            <Textarea
              id={commentsId}
              value={comments}
              onChange={(event) => setComments(event.target.value)}
            />
          </Field>
        </div>
        {ratingMissing ? <AlertLive id={ratingErrorId}>A rating is required</AlertLive> : null}
        {submit.isError ? <AlertLive>Unable to submit your evaluation.</AlertLive> : null}
      </CardContent>
      <CardFooter className="flex-wrap gap-3">
        <Button type="button" pending={submit.isPending} onClick={handleSubmit}>
          {submit.isPending ? 'Submitting…' : 'Submit'}
        </Button>
        {/* The ONE region for this outcome (DEC-014): in-flight and settled are
            the same sentence slot, so the submit result is never spoken twice.
            Politeness is declared here rather than inherited silently, so the
            announcement contract is legible where the outcome is written. */}
        <StatusLive aria-live="polite">
          {submit.isPending ? 'Submitting your evaluation…' : submittedMessage}
        </StatusLive>
      </CardFooter>
    </Card>
  )
}
