import { useEffect, useRef, useState } from 'react'
import { Show, SignInButton, useAuth } from '@clerk/react'

import { buttonVariants } from '../../../components/ui/button-variants'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
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
  const [terminalError, setTerminalError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!isLoaded || isSignedIn !== true || started.current || login.isPending || terminalError) {
      return
    }
    started.current = true
    void getToken()
      .then((token) => {
        if (token === null || token.length === 0) {
          setTerminalError(true)
          return
        }
        login.mutate(token, {
          onSuccess: onAuthed,
          onError: () => setTerminalError(true),
        })
      })
      .catch(() => setTerminalError(true))
  }, [attempt, getToken, isLoaded, isSignedIn, login, onAuthed, terminalError])

  if (terminalError) {
    return (
      <div className="grid gap-2">
        <AlertLive>
          This account is not authorized for organizer access. Use the organizer secret below, or
          retry Clerk sign-in explicitly.
        </AlertLive>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            started.current = false
            login.reset()
            setTerminalError(false)
            setAttempt((value) => value + 1)
          }}
        >
          Try Clerk sign-in again
        </Button>
      </div>
    )
  }

  return (
    <StatusLive aria-live="polite" className="text-center text-xs">
      {login.isPending ? 'Connecting your organizer session…' : 'Signed in. Opening the workspace…'}
    </StatusLive>
  )
}
