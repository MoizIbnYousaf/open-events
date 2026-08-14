import { useEffect, useRef } from 'react'
import { Show, SignInButton, SignUpButton, useAuth } from '@clerk/react'

import { buttonVariants } from '../../../components/ui/button-variants'
import { StatusLive } from '../../../components/ui/status-live'
import { useAdminClerkLogin } from '../../queries/admin-events'

const CLERK_TRIGGER_CLASS = buttonVariants({ variant: 'outline', className: 'w-full' })

/**
 * Organizer OAuth on the existing admin door. A verified Clerk session is
 * exchanged for the same HttpOnly organizer cookie the secret form issues, so
 * the rest of the admin API is unchanged. Speaker magic links are not used.
 */
export default function ClerkOrganizerAuth({ onAuthed }: { readonly onAuthed: () => void }) {
  return (
    <div className="grid gap-3">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className={CLERK_TRIGGER_CLASS}>
            Continue with Google or email
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button type="button" className={CLERK_TRIGGER_CLASS}>
            Create an organizer account
          </button>
        </SignUpButton>
        <p className="text-center text-xs text-muted-foreground">or use the organizer secret</p>
      </Show>
      <Show when="signed-in">
        <ClerkSessionExchange onAuthed={onAuthed} />
      </Show>
    </div>
  )
}

function ClerkSessionExchange({ onAuthed }: { readonly onAuthed: () => void }) {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const login = useAdminClerkLogin()
  const started = useRef(false)

  useEffect(() => {
    if (!isLoaded || isSignedIn !== true || started.current || login.isPending) return
    started.current = true
    void getToken().then((token) => {
      if (token === null || token.length === 0) {
        started.current = false
        return
      }
      login.mutate(token, {
        onSuccess: onAuthed,
        onError: () => {
          started.current = false
        },
      })
    })
  }, [getToken, isLoaded, isSignedIn, login, onAuthed])

  return (
    <StatusLive aria-live="polite" className="text-center text-xs">
      {login.isPending ? 'Connecting your organizer session…' : 'Signed in. Opening the workspace…'}
    </StatusLive>
  )
}
