import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { requestJson } from '../../api/admin-events'
import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { Item, ItemContent, ItemDescription, ItemTitle } from '../../../components/ui/item'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import type { AdminEventConfigDto } from '../../../application'
import { DEFAULT_EVENT_SLUG } from '../../lib/default-event'
import AppShell from '../nav/AppShell'

export default function EventsIndexPage() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [name, setName] = useState('')
  const events = useQuery({
    queryKey: ['admin', 'events'],
    queryFn: () => requestJson<readonly AdminEventConfigDto[]>('/api/admin/events'),
  })
  const create = useMutation({
    mutationFn: () =>
      requestJson<AdminEventConfigDto>('/api/admin/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    onSuccess: (created) => {
      void client.invalidateQueries({ queryKey: ['admin', 'events'] })
      void navigate({ to: '/admin/events/$slug', params: { slug: created.slug } })
    },
  })

  useEffect(() => {
    document.title = 'Events — Open Events'
  }, [])

  return (
    <AppShell slug={DEFAULT_EVENT_SLUG}>
      <div className="grid gap-4" data-tour="events-list">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Events</PageHeaderTitle>
            <PageHeaderDescription>Create and switch between events.</PageHeaderDescription>
          </PageHeaderContent>
        </PageHeader>
        {(events.data ?? []).length === 0 && !events.isPending ? (
          <EmptyState
            title="No events yet"
            description="Create an event to open its organizer workspace."
          />
        ) : (
          <ul className="grid gap-2">
            {(events.data ?? []).map((event) => (
              <li key={event.id}>
                <Link to="/admin/events/$slug" params={{ slug: event.slug }}>
                  <Item variant="outline">
                    <ItemContent>
                      <ItemTitle>{event.name}</ItemTitle>
                      <ItemDescription>{event.slug}</ItemDescription>
                    </ItemContent>
                  </Item>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid max-w-sm gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <Field>
            <FieldLabel htmlFor="new-event-name">New event name</FieldLabel>
            <Input
              id="new-event-name"
              value={name}
              onChange={(change) => setName(change.target.value)}
            />
          </Field>
          <Button type="submit" pending={create.isPending}>
            Create event
          </Button>
        </form>
      </div>
    </AppShell>
  )
}
