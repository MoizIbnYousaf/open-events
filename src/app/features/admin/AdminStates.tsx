import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'

const titleClass = 'font-heading text-base leading-snug font-medium'
// Full-page states center themselves; LoadErrorState stays inline where it renders.
const pageStateClass = 'mx-auto w-full max-w-md px-4 py-16'

export function ForbiddenState() {
  return (
    <div className={pageStateClass}>
      <Card>
        <CardContent className="grid gap-3">
          <h1 className={titleClass}>Access forbidden</h1>
          <AlertLive>You do not have permission to view this page.</AlertLive>
        </CardContent>
      </Card>
    </div>
  )
}

export function DeniedState() {
  return (
    <div className={pageStateClass}>
      <Card>
        <CardContent className="grid gap-3">
          <h1 className={titleClass}>Not found</h1>
          <AlertLive>This page could not be found.</AlertLive>
        </CardContent>
      </Card>
    </div>
  )
}

export function ExpiredSessionState({ onLogin }: { readonly onLogin: () => void }) {
  return (
    <div className={pageStateClass}>
      <Card>
        <CardContent className="grid gap-3">
          <h1 className={titleClass}>Session expired</h1>
          <AlertLive>Your session has expired. Sign in again to continue.</AlertLive>
          <Button onClick={onLogin}>Sign in again</Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function LoadErrorState({
  message,
  pending = false,
  onRetry,
}: {
  readonly message: string
  /** True while the retry it triggers is in flight, so the control says so. */
  readonly pending?: boolean
  readonly onRetry: () => void
}) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <h1 className={titleClass}>Something went wrong</h1>
        <AlertLive>{message}</AlertLive>
        <Button variant="outline" pending={pending} onClick={onRetry}>
          {pending ? 'Trying again…' : 'Retry'}
        </Button>
      </CardContent>
    </Card>
  )
}
