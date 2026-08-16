import { useState } from 'react'

import { Button } from '../../../components/ui/button'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { StatusLive } from '../../../components/ui/status-live'

/**
 * The copyable magic-link an organizer just minted for a reviewer.
 *
 * Assigning by email is not a complete provision without a way for that person
 * to sign in. The captured inbox holds the same URL; this is the on-screen
 * copy the judge (and the organizer) can grab without leaving the desk.
 */
export default function ReviewerInviteLink({ path }: { readonly path: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-2">
      <Field>
        <FieldLabel htmlFor="reviewer-invite-link">Reviewer sign-in link</FieldLabel>
        <Input id="reviewer-invite-link" readOnly value={path} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(path).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }}
        >
          Copy sign-in link
        </Button>
        <StatusLive aria-label="Invite link">
          {copied
            ? 'Copied. If it expires, ask an organizer to issue a fresh reviewer invitation.'
            : 'One-time access — this link opens only the review queue.'}
        </StatusLive>
      </div>
    </div>
  )
}
