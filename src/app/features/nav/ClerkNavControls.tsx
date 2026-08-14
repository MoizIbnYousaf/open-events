import { Show, UserButton } from '@clerk/react'

/** Header account control. Rendered only inside ClerkProvider. */
export default function ClerkNavControls() {
  return (
    <Show when="signed-in">
      <UserButton />
    </Show>
  )
}
