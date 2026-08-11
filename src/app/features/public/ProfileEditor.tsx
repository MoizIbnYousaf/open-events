import { useState } from 'react'
import { toast } from 'sonner'

import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Field, FieldControl, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { Skeleton } from '../../../components/ui/skeleton'
import { StatusLive } from '../../../components/ui/status-live'
import { Textarea } from '../../../components/ui/textarea'
import { useOwnProfile, useUpdateProfile } from '../../queries/public-profile'

/**
 * REQ-006 speaker profile editor. Reads and writes the real persisted
 * name/bio; email is read-only identity and rendered as text, never as a
 * control. Composable section (no h1); a server rejection keeps the edits on
 * screen with a generic alert — no optimistic success.
 */
export default function ProfileEditor() {
  const profile = useOwnProfile()
  const data = profile.data

  if (profile.isPending) {
    return (
      <section aria-label="Your profile" aria-busy="true">
        <Card>
          <CardContent className="grid gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-8 w-full" />
            <StatusLive>Loading your profile…</StatusLive>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (profile.isError || data === undefined) {
    return (
      <section aria-label="Your profile">
        <Card>
          <CardContent className="grid gap-3">
            <AlertLive>Unable to load your profile.</AlertLive>
            <Button
              variant="outline"
              pending={profile.isFetching}
              onClick={() => void profile.refetch()}
            >
              {profile.isFetching ? 'Trying again…' : 'Try again'}
            </Button>
          </CardContent>
        </Card>
      </section>
    )
  }

  return <ProfileForm key={data.email} initial={data} />
}

function ProfileForm({
  initial,
}: {
  readonly initial: { readonly name: string; readonly email: string; readonly bio: string | null }
}) {
  const update = useUpdateProfile()
  const [name, setName] = useState(initial.name)
  const [bio, setBio] = useState(initial.bio ?? '')

  const submit = () => {
    update.mutate(
      { name, bio: bio.trim().length === 0 ? null : bio },
      {
        onSuccess: () => toast.success('Profile saved'),
      },
    )
  }

  return (
    <section aria-labelledby="profile-heading" className="grid gap-3">
      <h2 id="profile-heading" className="text-lg font-semibold">
        Your profile
      </h2>
      <Card>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium">{initial.email}</span>
          </p>
          <form
            noValidate
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Field>
              <FieldLabel htmlFor="profile-name">Name</FieldLabel>
              <Input
                id="profile-name"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-bio">Bio</FieldLabel>
              <FieldControl
                render={
                  <Textarea
                    id="profile-bio"
                    value={bio}
                    maxLength={2000}
                    onChange={(event) => setBio(event.target.value)}
                  />
                }
              />
            </Field>
            {update.isError ? <AlertLive>Unable to save your profile.</AlertLive> : null}
            <div className="flex items-center gap-3">
              <Button type="submit" pending={update.isPending}>
                {update.isPending ? 'Saving profile…' : 'Save profile'}
              </Button>
              <StatusLive>{update.isPending ? 'Saving your profile…' : null}</StatusLive>
              {update.isSuccess && !update.isPending ? (
                <span className="text-sm text-muted-foreground">Profile saved</span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  )
}
