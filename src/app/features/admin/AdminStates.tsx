import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'

const titleClass = 'font-heading text-base leading-snug font-medium'

export function ForbiddenState() {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <h1 className={titleClass}>Access forbidden</h1>
        <AlertLive>You do not have permission to view this page.</AlertLive>
      </CardContent>
    </Card>
  )
}

export function DeniedState() {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <h1 className={titleClass}>Not found</h1>
        <AlertLive>This page could not be found.</AlertLive>
      </CardContent>
    </Card>
  )
}

export function ExpiredSessionState({ onLogin }: { readonly onLogin: () => void }) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <h1 className={titleClass}>Session expired</h1>
        <AlertLive>Your session has expired. Sign in again to continue.</AlertLive>
        <Button onClick={onLogin}>Sign in again</Button>
      </CardContent>
    </Card>
  )
}

export function LoadErrorState({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => void
}) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <h1 className={titleClass}>Something went wrong</h1>
        <AlertLive>{message}</AlertLive>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  )
}
