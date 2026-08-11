import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { getApiErrorCode } from '../../api/admin-events'
import {
  describeHeadshotRejection,
  useOwnHeadshot,
  useUploadHeadshot,
} from '../../queries/public-headshot'

const INPUT_ID = 'headshot-file'

const IN_FLIGHT_MESSAGE =
  'Another headshot is still uploading — that file was not sent. Choose it again to retry.'

/**
 * Speaker headshot upload. The picked file is validated client-side against
 * the same envelope the API enforces, uploaded with a real PUT, and the
 * stored image is re-read from the server afterwards — no optimistic or
 * mocked success state.
 *
 * Composable section: it is rendered both standalone at /headshot and inside
 * the portal, so it owns no h1 and the host page keeps its page-owned heading.
 */
export default function HeadshotUploader() {
  const headshot = useOwnHeadshot()
  const upload = useUploadHeadshot()
  const [rejection, setRejection] = useState<string | null>(null)
  const [refusedInFlight, setRefusedInFlight] = useState(false)
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
    // Clear the selection as soon as it is read, BEFORE any early return. The
    // advertised retry is "choose the file again", and re-picking an identical
    // selection fires no change event while it is still in the input — so the
    // input must be empty on every path out of this handler, including the
    // in-flight one, or the control is left dead until a third file is chosen.
    if (input !== null && input !== undefined) input.value = ''
    // The control stays enabled while an upload is in flight — a natively
    // disabled input throws keyboard focus to <body> mid-flow — so re-entry is
    // guarded here. A pick made during that window is never silently dropped:
    // it is refused out loud, and the emptied input makes the same file
    // choosable again.
    if (upload.isPending) {
      setRefusedInFlight(true)
      return
    }
    setRejection(null)
    setRefusedInFlight(false)
    upload.reset()
    if (file === undefined) return
    const problem = describeHeadshotRejection(file)
    if (problem !== null) {
      setRejection(problem)
      return
    }
    // A toast on success only. The uploader is composed into the portal
    // beside the task list, so the speaker does leave this surface — and the
    // re-read image plus the "Headshot updated" label below stay behind as the
    // durable record (DEC-019). No announce() and no live region beside it:
    // two channels carrying the same sentence speak it twice (DEC-014).
    upload.mutate(file, { onSuccess: () => toast.success('Headshot updated') })
  }

  // The refusal above describes a condition that ends without the speaker
  // doing anything, so it is derived from the flight rather than stored as a
  // sentence. Storing it left a settled upload announcing "Headshot updated"
  // beside an alert still claiming an upload was running, kept the file input
  // marked invalid with nothing wrong with it, and hid a genuine upload
  // failure behind the stale refusal.
  const problem =
    (refusedInFlight && upload.isPending ? IN_FLIGHT_MESSAGE : null) ??
    rejection ??
    (upload.isError ? uploadErrorMessage(getApiErrorCode(upload.error), upload.error) : null)

  return (
    <section aria-labelledby="headshot-heading" className="grid gap-4">
      <h2 id="headshot-heading" className="text-lg font-semibold">
        Headshot
      </h2>
      <Card>
        <CardContent className="grid gap-3">
          <Preview
            isPending={headshot.isPending}
            isError={headshot.isError}
            isFetching={headshot.isFetching}
            onRetry={() => void headshot.refetch()}
            objectUrl={objectUrl}
          />
          {/*
            The file input is the control the problem belongs to: a rejected
            or failed upload used to render its message with no id and leave
            the input with no aria-invalid, so assistive tech had no way to
            connect the two. `problem` is the single source for both.
          */}
          <Field invalid={problem !== null}>
            <FieldLabel htmlFor={INPUT_ID} className="font-medium">
              Upload a headshot (JPEG, PNG, or WebP, up to 2 MB)
            </FieldLabel>
            <input
              id={INPUT_ID}
              aria-label="Upload a headshot"
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="min-h-6 text-sm"
              aria-invalid={problem !== null ? true : undefined}
              aria-describedby={problem !== null ? `${INPUT_ID}-error` : undefined}
              onChange={onPick}
            />
            {problem !== null ? <FieldError id={`${INPUT_ID}-error`}>{problem}</FieldError> : null}
          </Field>
          {upload.isPending ? (
            <StatusLive aria-live="polite">Uploading your headshot…</StatusLive>
          ) : null}
          {/* The label that stays, not a second live region: the outcome is
              spoken once by the toaster (DEC-014, DEC-019), and this is still
              the on-page record beside the re-read image. */}
          {upload.isSuccess ? (
            <span className="text-sm text-muted-foreground">Headshot updated</span>
          ) : null}
          {problem !== null ? <AlertLive>{problem}</AlertLive> : null}
        </CardContent>
      </Card>
    </section>
  )
}

function Preview({
  isPending,
  isError,
  isFetching,
  onRetry,
  objectUrl,
}: {
  readonly isPending: boolean
  readonly isError: boolean
  readonly isFetching: boolean
  readonly onRetry: () => void
  readonly objectUrl: string | undefined
}) {
  if (isPending) {
    return (
      <div aria-busy="true">
        <Skeleton className="h-24 w-24" />
        <StatusLive aria-live="polite">Loading your headshot…</StatusLive>
      </div>
    )
  }
  if (isError) {
    return (
      <div className="grid gap-2">
        <AlertLive>Unable to load your headshot.</AlertLive>
        <Button
          type="button"
          variant="outline"
          className="min-h-6"
          pending={isFetching}
          onClick={onRetry}
        >
          {isFetching ? 'Trying again…' : 'Try again'}
        </Button>
      </div>
    )
  }
  if (objectUrl === undefined) {
    return <StatusLive aria-live="polite">No headshot uploaded yet.</StatusLive>
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
