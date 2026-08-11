import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES } from '../../../application/services/documents'
import { getApiErrorCode } from '../../api/admin-events'
import { AlertLive } from '../../../components/ui/alert-live'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { DocumentIcon } from '../../../components/ui/icons'
import { Field, FieldError, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { StatusLive } from '../../../components/ui/status-live'
import { SectionHeading } from '../../../components/ui/section-heading'
import { useUploadDocument } from '../../queries/public-profile'

const INPUT_ID = 'document-file'

/**
 * Both speaker uploaders share one control recipe. They used to differ: this
 * one carried `required` on a file the surrounding copy calls optional, which
 * put `invalid` on the control on first paint with nothing wrong, and both sat
 * at 38px against the app's 32px control height.
 */
export const FILE_INPUT_CLASS =
  'cursor-pointer py-0 file:mr-2.5 file:h-6 file:cursor-pointer file:rounded-sm file:bg-secondary file:px-2 file:text-secondary-foreground'

/** 5 MB expressed once, so the copy and the guard can never drift apart. */
const MAX_MEGABYTES = Math.round(DOCUMENT_MAX_BYTES / (1024 * 1024))

/**
 * REQ-007 supporting document (PDF or plain text — deliberately no slide-deck
 * claim). Mirrors the server allow-list client-side, uploads real bytes with
 * the explicit x-file-name header, and shows the stored metadata the server
 * answered — never an optimistic success. Composable section, no h1.
 */
export default function DocumentUploader() {
  const upload = useUploadDocument()
  const [rejection, setRejection] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onPick = (): void => {
    const input = inputRef.current
    const file = input?.files?.[0]
    if (input !== null && input !== undefined) input.value = ''
    if (file === undefined) return
    setRejection(null)
    if (!DOCUMENT_CONTENT_TYPES.some((allowed) => allowed === file.type)) {
      setRejection('That file type is not supported — upload a PDF or plain text file.')
      return
    }
    if (file.size === 0) {
      setRejection('That file is empty.')
      return
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      setRejection(`That file is larger than the ${MAX_MEGABYTES} MB limit.`)
      return
    }
    upload.mutate(file, {
      onSuccess: () => toast.success('Supporting document uploaded'),
      // A refusal and a failure are different answers, and only one of them
      // is worth choosing the file again for.
      onError: (error) =>
        setRejection(
          getApiErrorCode(error) === 'forbidden'
            ? 'You do not have permission to upload a document here.'
            : 'The document could not be uploaded.',
        ),
    })
  }

  const stored = upload.data

  return (
    <section aria-labelledby="document-heading">
      <Card>
        <CardHeader>
          <SectionHeading id="document-heading">Supporting document</SectionHeading>
        </CardHeader>
        <CardContent className="grid gap-3">
          {/*
            The rejection message belongs to the input, exactly as the headshot
            uploader's does: it used to float beside the control as an alert
            with no id, so assistive tech was told something was wrong without
            being told what was wrong with. One `rejection` value now drives the
            invalid state, the described-by wiring and the alert together.
          */}
          <Field invalid={rejection !== null}>
            <FieldLabel htmlFor={INPUT_ID}>Supporting document</FieldLabel>
            <Input
              id={INPUT_ID}
              ref={inputRef}
              type="file"
              accept="application/pdf,text/plain"
              className={FILE_INPUT_CLASS}
              aria-invalid={rejection !== null ? true : undefined}
              aria-describedby={rejection !== null ? `${INPUT_ID}-error` : undefined}
              onChange={onPick}
            />
            <p className="text-xs text-muted-foreground">
              One PDF or plain text file, {MAX_MEGABYTES} MB max.
            </p>
            {rejection !== null ? (
              <FieldError id={`${INPUT_ID}-error`}>{rejection}</FieldError>
            ) : null}
          </Field>
          {rejection !== null ? <AlertLive>{rejection}</AlertLive> : null}
          <StatusLive>{upload.isPending ? 'Uploading your document…' : null}</StatusLive>
          {stored !== undefined && !upload.isPending ? (
            /*
              What the server answered for THIS upload, and nothing more. There
              is no read endpoint for a stored document, so the record cannot
              claim to describe what the server holds — only what was just sent.
              The copy says so rather than implying a durable state the page
              cannot actually check.
            */
            <div className="grid gap-0.5 rounded-lg p-3 ring-1 ring-border">
              <span className="truncate text-sm font-medium">{stored.fileName}</span>
              <span className="text-xs text-muted-foreground">
                {stored.contentType}, {stored.sizeBytes} bytes
              </span>
              <span className="text-xs text-muted-foreground">
                Uploaded just now. Organizers keep it with your proposal; this page only shows what
                you sent in this session.
              </span>
            </div>
          ) : (
            <EmptyState
              icon={<DocumentIcon size={20} />}
              title="Add a supporting document"
              description="No supporting document uploaded yet. A written outline or an accessibility note helps organizers place your session."
            />
          )}
        </CardContent>
      </Card>
    </section>
  )
}
