import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { getApiErrorCode } from '../../api/admin-events'
import {
  publicEvaluationsQueryKeys,
  usePublicEvaluations,
  useSubmitEvaluation,
  type EvaluationRow,
} from '../../queries/public-evaluations'
import { ExpiredSessionState, ForbiddenState } from '../admin/AdminStates'

const fieldClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none disabled:opacity-50 md:text-sm'

export default function EvaluationsPage() {
  const queryClient = useQueryClient()
  const query = usePublicEvaluations()
  const submit = useSubmitEvaluation()
  const [rating, setRating] = useState(1)
  const [comments, setComments] = useState('')

  useEffect(() => {
    document.title = 'Evaluations — SpeakerOps'
  }, [])

  const code = getApiErrorCode(query.error)
  if (code === 'unauthorized') {
    // Recovery navigation lands with the evaluations server work; the UI
    // contract only pins the expired-session surface.
    return <ExpiredSessionState onLogin={() => undefined} />
  }
  if (code === 'forbidden') {
    return <ForbiddenState />
  }
  if (query.isError || query.data === null) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">Evaluations</h1>
        <Card>
          <CardContent className="grid gap-3">
            <AlertLive>Unable to load evaluations.</AlertLive>
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
        <h1 className="text-2xl font-semibold">Evaluations</h1>
        <Card>
          <CardContent>
            <StatusLive>No evaluations yet.</StatusLive>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleSubmit = () => {
    const submissionId = rows[0]?.submissionId
    if (submissionId === undefined) return
    const trimmedComments = comments.trim()
    submit.mutate(
      {
        submissionId,
        rating,
        comments: trimmedComments.length === 0 ? undefined : trimmedComments,
      },
      {
        onSuccess: () => {
          submit.reset()
          void queryClient.invalidateQueries({ queryKey: publicEvaluationsQueryKeys.all })
        },
      },
    )
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Evaluations</h1>
      <Card>
        <CardContent className="grid gap-3">
          {rows.map((row) => (
            <EvaluationRowCard key={row.submissionId} row={row} />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3">
          <h2 className="text-lg font-semibold">Evaluate a session</h2>
          <div className="grid gap-1.5">
            <label htmlFor="evaluation-rating">Rating</label>
            <select
              id="evaluation-rating"
              value={rating}
              onChange={(event) => setRating(Number(event.target.value))}
              className={fieldClass}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="evaluation-comments">Comments (optional)</label>
            <textarea
              id="evaluation-comments"
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              className={`${fieldClass} min-h-24 resize-y`}
            />
          </div>
          <div>
            <Button type="button" onClick={handleSubmit}>
              Submit
            </Button>
          </div>
          {submit.isError ? <AlertLive>Unable to submit your evaluation.</AlertLive> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function EvaluationRowCard({ row }: { readonly row: EvaluationRow }) {
  return (
    <div className="grid gap-1 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">{row.sessionTitle}</p>
      <p className="text-sm">Rating: {row.rating}</p>
      <p className="text-sm">Comments: {row.comments}</p>
      <p className="text-sm text-muted-foreground">Updated: {row.updatedAt}</p>
    </div>
  )
}
