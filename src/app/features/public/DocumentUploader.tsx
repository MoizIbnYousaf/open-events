import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { DOCUMENT_CONTENT_TYPES, DOCUMENT_MAX_BYTES } from '../../../application/services/documents'
import { AlertLive } from '../../../components/ui/alert-live'
import { Card, CardContent } from '../../../components/ui/card'
import { Field, FieldControl, FieldLabel } from '../../../components/ui/field'
import { StatusLive } from '../../../components/ui/status-live'
import { useUploadDocument } from '../../queries/public-profile'

const INPUT_ID = 'document-file'

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
      setRejection('That file is larger than the 5 MB limit.')
      return
    }
    upload.mutate(file, {
      onSuccess: () => toast.success('Supporting document uploaded'),
      onError: () => setRejection('The document could not be uploaded.'),
    })
  }

  const stored = upload.data

  return (
    <section aria-labelledby="document-heading" className="grid gap-3">
      <h2 id="document-heading" className="text-lg font-semibold">
        Supporting document
      </h2>
      <Card>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Upload one supporting document as PDF or plain text (up to 5 MB).
          </p>
          <div className="grid gap-3">
            <Field invalid={rejection !== null}>
              <FieldLabel htmlFor={INPUT_ID}>Supporting document</FieldLabel>
              <FieldControl
                render={
                  <input
                    id={INPUT_ID}
                    ref={inputRef}
                    type="file"
                    accept="application/pdf,text/plain"
                    required
                    className="text-sm"
                    onChange={onPick}
                  />
                }
              />
            </Field>
            {rejection !== null ? <AlertLive>{rejection}</AlertLive> : null}
            <StatusLive>{upload.isPending ? 'Uploading your document…' : null}</StatusLive>
            {stored !== undefined && !upload.isPending ? (
              <p className="text-sm">
                Stored: <span className="font-medium">{stored.fileName}</span>{' '}
                <span className="text-muted-foreground">
                  ({stored.contentType}, {stored.sizeBytes} bytes)
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No supporting document uploaded yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
