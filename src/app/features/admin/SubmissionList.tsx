import { useEffect } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'

import type { SubmissionListItemDto } from '../../../application'
import { getApiErrorCode } from '../../api/admin-events'
import { useSubmissionList } from '../../queries/admin-submissions'
import { AlertLive } from '../../../components/ui/alert-live'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { DeniedState, ExpiredSessionState } from './AdminStates'

function statusText(status: SubmissionListItemDto['status']): string {
  return status === 'pending' ? 'Pending' : status
}

const submittedFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatSubmitted(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : submittedFormatter.format(date)
}

export default function SubmissionList() {
  const params = useParams({ strict: false })
  const slug = params.slug as string | undefined
  const navigate = useNavigate()
  const listQuery = useSubmissionList(slug)

  useEffect(() => {
    document.title = 'Submissions — SpeakerOps'
  }, [])

  if (listQuery.isError) {
    const code = getApiErrorCode(listQuery.error)
    if (code === 'unauthorized') {
      return <ExpiredSessionState onLogin={() => void navigate({ to: '/admin' })} />
    }
    if (code === 'forbidden' || code === 'not_found') {
      return <DeniedState />
    }
  }

  return (
    <section aria-label="Submissions" aria-busy={listQuery.isPending} className="grid gap-4">
      <h1 className="text-2xl font-semibold">Submissions</h1>
      {listQuery.isPending ? (
        <Card>
          <CardContent>
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ) : listQuery.isError ? (
        <div className="grid gap-3">
          <AlertLive>Unable to load submissions.</AlertLive>
          <Button variant="outline" onClick={() => void listQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : listQuery.data !== undefined && listQuery.data.length === 0 ? (
        <div className="grid gap-3">
          <StatusLive aria-label="No submissions">No submissions yet.</StatusLive>
          <Button variant="outline" onClick={() => void listQuery.refetch()}>
            Refresh
          </Button>
        </div>
      ) : listQuery.data !== undefined ? (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th scope="col" className="py-2 pr-4 font-medium">
                Title
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Status
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Primary speaker
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Co-speakers
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Form/Version
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Track/Tags
              </th>
              <th scope="col" className="py-2 font-medium">
                Submitted
              </th>
            </tr>
          </thead>
          <tbody>
            {listQuery.data.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="py-2 pr-4">
                  <Link
                    to="/admin/events/$slug/submissions/$submissionId"
                    params={{ slug: slug ?? '', submissionId: row.id }}
                    aria-label={`${row.title} — ${statusText(row.status)} — ${row.primarySpeaker.name}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {row.title}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <Badge>{statusText(row.status)}</Badge>
                </td>
                <td className="py-2 pr-4">{row.primarySpeaker.name}</td>
                <td className="py-2 pr-4">{row.coSpeakerCount}</td>
                <td className="py-2 pr-4">
                  {row.formSlug} v{row.version}
                </td>
                <td className="py-2 pr-4">{row.routing?.actionTarget ?? '—'}</td>
                <td className="py-2">{formatSubmitted(row.submittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}
