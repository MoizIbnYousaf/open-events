import { useEffect, useRef, useState } from 'react'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { getApiErrorCode } from '../../api/admin-events'
import {
  describeHeadshotRejection,
  useOwnHeadshot,
  useUploadHeadshot,
} from '../../queries/public-headshot'

const INPUT_ID = 'headshot-file'

/**
 * Speaker headshot upload. The picked file is validated client-side against
 * the same envelope the API enforces, uploaded with a real PUT, and the
 * stored image is re-read from the server afterwards — no optimistic or
 * mocked success state.
 */
export default function HeadshotUploader() {
  const headshot = useOwnHeadshot()
  const upload = useUploadHeadshot()
  const [rejection, setRejection] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const objectUrl = headshot.data?.objectUrl
  useEffect(() => {
    return () => {
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])

  const onPick = (): void => {
    const input = inputRef.current
    const file = input?.files?.[0]
    setRejection(null)
    upload.reset()
    // Clear the selection as soon as it is read. The advertised retry is
    // "choose the file again", and re-picking an identical selection fires no
    // change event while it is still in the input — so the input must be
    // empty for every retry path (client rejection, 4xx, network failure).
    if (input !== null && input !== undefined) input.value = ''
    if (file === undefined) return
    const problem = describeHeadshotRejection(file)
    if (problem !== null) {
      setRejection(problem)
      return
    }
    upload.mutate(file)
  }

  return (
    <section className="grid gap-4">
      <h1 className="text-2xl font-semibold">Headshot</h1>
      <Card>
        <CardContent className="grid gap-3">
          <Preview
            isPending={headshot.isPending}
            isError={headshot.isError}
            onRetry={() => void headshot.refetch()}
            objectUrl={objectUrl}
          />
          <label htmlFor={INPUT_ID} className="text-sm font-medium">
            Upload a headshot (JPEG, PNG, or WebP, up to 2 MB)
          </label>
          <input
            id={INPUT_ID}
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="min-h-6 text-sm"
            disabled={upload.isPending}
            onChange={onPick}
          />
          {upload.isPending ? <StatusLive>Uploading your headshot…</StatusLive> : null}
          {upload.isSuccess ? <StatusLive>Headshot updated</StatusLive> : null}
          {rejection !== null ? <AlertLive>{rejection}</AlertLive> : null}
          {upload.isError ? (
            <AlertLive>{uploadErrorMessage(getApiErrorCode(upload.error), upload.error)}</AlertLive>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function Preview({
  isPending,
  isError,
  onRetry,
  objectUrl,
}: {
  readonly isPending: boolean
  readonly isError: boolean
  readonly onRetry: () => void
  readonly objectUrl: string | undefined
}) {
  if (isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-24 w-24" />
        <StatusLive>Loading your headshot…</StatusLive>
      </div>
    )
  }
  if (isError) {
    return (
      <div className="grid gap-2">
        <AlertLive>Unable to load your headshot.</AlertLive>
        <Button type="button" variant="outline" className="min-h-6" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  if (objectUrl === undefined) {
    return <StatusLive>No headshot uploaded yet.</StatusLive>
  }
  return <img src={objectUrl} alt="Your current headshot" className="h-24 w-24 object-cover" />
}

function uploadErrorMessage(code: string | null, error: unknown): string {
  const status = error instanceof Error && 'status' in error ? Number(error.status) : 0
  if (status === 413) return 'That image is too large — choose an image of 2 MB or less.'
  if (status === 415) return 'That file type is not supported — choose a JPEG, PNG, or WebP image.'
  if (code === 'unauthorized') return 'Your session expired — start again to upload a headshot.'
  return 'Upload failed. Choose the file again to retry.'
}
