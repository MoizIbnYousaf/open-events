import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { InboxIcon } from '../../../components/ui/icons'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { SectionHeading } from '../../../components/ui/section-heading'
import { getApiErrorCode } from '../../api/admin-events'
import {
  describeHeadshotRejection,
  useOwnHeadshot,
  useUploadHeadshot,
} from '../../queries/public-headshot'
import { FILE_INPUT_CLASS } from './DocumentUploader'

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

  // A 403 is a different answer from a transient failure: retrying it can only
  // produce the same 403, so the denied branch offers no control to press.
  const loadDenied = getApiErrorCode(headshot.error) === 'forbidden'
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
    <section aria-labelledby="headshot-heading">
      <Card>
        <CardHeader>
          <SectionHeading id="headshot-heading">Headshot</SectionHeading>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[7rem_1fr] sm:items-start sm:gap-4">
          <Preview
            state={previewState(headshot.isPending, loadDenied, headshot.isError)}
            isRetrying={headshot.isFetching}
            onRetry={() => void headshot.refetch()}
            objectUrl={objectUrl}
          />
          <div className="grid gap-3">
            {/*
              The file input is the control the problem belongs to: a rejected
              or failed upload used to render its message with no id and leave
              the input with no aria-invalid, so assistive tech had no way to
              connect the two. `problem` is the single source for both.
            */}
            <Field invalid={problem !== null}>
              <FieldLabel htmlFor={INPUT_ID}>Upload a headshot</FieldLabel>
              <Input
                id={INPUT_ID}
                aria-label="Upload a headshot"
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className={FILE_INPUT_CLASS}
                aria-invalid={problem !== null ? true : undefined}
                aria-describedby={problem !== null ? `${INPUT_ID}-error` : undefined}
                onChange={onPick}
              />
              {/* Guidance stays a plain sibling, not a Field description: a
                  description would register itself into the input's
                  aria-describedby, and that attribute is reserved here for the
                  one `problem` message so a screen reader hears the fault and
                  nothing else when something is wrong. */}
              <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, 2 MB max.</p>
              {problem !== null ? (
                <FieldError id={`${INPUT_ID}-error`}>{problem}</FieldError>
              ) : null}
            </Field>
            {upload.isPending ? (
              <StatusLive aria-live="polite">Uploading your headshot…</StatusLive>
            ) : null}
            {/* The record slot, in the content column and in the same place its
                sibling section keeps its own: the "nothing here yet" sentence
                used to live inside the 112px preview column, where it wrapped
                to two lines beside an empty card. Both upload sections now say
                the same thing the same way. */}
            {headshot.isPending || headshot.isError || objectUrl !== undefined ? null : (
              <EmptyState
                icon={<InboxIcon size={20} />}
                title="Add your headshot"
                description={
                  <StatusLive aria-live="polite">
                    No headshot uploaded yet. Organizers publish it beside your session.
                  </StatusLive>
                }
              />
            )}
            {/* The label that stays, not a second live region: the outcome is
                spoken once by the toaster (DEC-014, DEC-019), and this is still
                the on-page record beside the re-read image. */}
            {upload.isSuccess ? (
              <span className="text-sm text-muted-foreground">Headshot updated</span>
            ) : null}
            {problem !== null ? <AlertLive>{problem}</AlertLive> : null}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

/**
 * What the preview is showing, as one value rather than four on/off props.
 *
 * The four booleans it replaces (`isPending`, `isDenied`, `isError`, plus the
 * `objectUrl` presence test) described a single position in one sequence, and
 * only four of their sixteen combinations were reachable — a shape that is
 * impossible to test exhaustively and easy to hand a contradiction to
 * (`react-doctor/no-many-boolean-props`). `isRetrying` stays a flag because it
 * genuinely is one: a refetch can be in flight underneath any state.
 */
type PreviewState = 'loading' | 'denied' | 'error' | 'ready'

function previewState(isPending: boolean, isDenied: boolean, isError: boolean): PreviewState {
  if (isPending) return 'loading'
  if (isDenied) return 'denied'
  return isError ? 'error' : 'ready'
}

function Preview({
  state,
  isRetrying,
  onRetry,
  objectUrl,
}: {
  readonly state: PreviewState
  readonly isRetrying: boolean
  readonly onRetry: () => void
  readonly objectUrl: string | undefined
}) {
  /**
   * The URI whose bytes the browser refused to decode, remembered so the same
   * one is never asked for twice.
   *
   * An object URL can stop resolving after it was handed over — a revoked
   * blob, a signature that expired between fetch and paint — and until now
   * that painted the browser's own broken-image glyph inside our hairline
   * ring, on the speaker's own portal. The fallback is the placeholder that
   * already exists for "no photo yet", because from the reader's side those
   * are the same sentence: there is no picture here.
   *
   * It holds the failed URI rather than a boolean so the memory is scoped to
   * the thing that failed. A fresh upload produces a fresh URL, which does not
   * match, so a successful retry paints immediately instead of inheriting the
   * last one's verdict — and a re-render of the broken one asks the network
   * nothing.
   */
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (state === 'loading') {
    return (
      <div aria-busy="true" className="grid gap-2">
        <Skeleton className="size-28 rounded-full" />
        <StatusLive aria-live="polite">Loading your headshot…</StatusLive>
      </div>
    )
  }
  if (state === 'denied') {
    return <AlertLive>You do not have permission to view this headshot.</AlertLive>
  }
  if (state === 'error') {
    return (
      <div className="grid justify-items-start gap-2">
        <AlertLive>Unable to load your headshot.</AlertLive>
        <Button type="button" variant="outline" size="sm" pending={isRetrying} onClick={onRetry}>
          {isRetrying ? 'Trying again…' : 'Try again'}
        </Button>
      </div>
    )
  }
  if (objectUrl === undefined || failedUrl === objectUrl) {
    // The empty avatar is a real shape, not a gap: the slot exists and is
    // waiting. It is a filled placeholder rather than a dashed one, because the
    // dashed frame is the section's one empty-state grammar and it belongs to
    // the box in the content column, not to the picture frame.
    return (
      <span
        aria-hidden="true"
        className="grid size-28 place-items-center rounded-full border border-border bg-muted text-xs text-muted-foreground"
      >
        No photo
      </span>
    )
  }
  // A hairline wrapper ring so a light photo cannot bleed into a light card.
  return (
    <img
      src={objectUrl}
      alt="Your current headshot"
      onError={() => setFailedUrl(objectUrl)}
      className="size-28 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/15"
    />
  )
}

function uploadErrorMessage(code: string | null, error: unknown): string {
  const status = error instanceof Error && 'status' in error ? Number(error.status) : 0
  if (status === 413) return 'That image is too large — choose an image of 2 MB or less.'
  if (status === 415) return 'That file type is not supported — choose a JPEG, PNG, or WebP image.'
  if (code === 'unauthorized') return 'Your session expired — start again to upload a headshot.'
  if (code === 'forbidden') return 'You do not have permission to upload a headshot here.'
  return 'Upload failed. Choose the file again to retry.'
}
