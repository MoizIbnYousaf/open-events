import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { requestJson } from '../../api/admin-events'
import { Button } from '../../../components/ui/button'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '../../../components/ui/item'
import { NativeSelect } from '../../../components/ui/native-select'
import { Textarea } from '../../../components/ui/textarea'
import { buttonVariants } from '../../../components/ui/button-variants'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import AppShell from '../nav/AppShell'
import { embedPreviewHref, type EmbedDto } from '../../../application/services/embeds'
import { EMBED_FORMATS, EMBED_KINDS } from '../../../domain/embed'

export default function EmbedsPage({ eventSlug }: { readonly eventSlug: string }) {
  const client = useQueryClient()
  const [name, setName] = useState('Sessions list')
  const [kind, setKind] = useState<(typeof EMBED_KINDS)[number]>('sessions')
  const [format, setFormat] = useState<(typeof EMBED_FORMATS)[number]>('html')
  const embeds = useQuery({
    queryKey: ['admin', 'embeds', eventSlug],
    queryFn: () => requestJson<readonly EmbedDto[]>(`/api/admin/events/${eventSlug}/embeds`),
  })
  const create = useMutation({
    mutationFn: () =>
      requestJson<EmbedDto>(`/api/admin/events/${eventSlug}/embeds`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, kind, format }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'embeds', eventSlug] })
    },
  })

  useEffect(() => {
    document.title = 'Embeds — Open Events'
  }, [])

  return (
    <AppShell slug={eventSlug}>
      <div className="grid gap-4">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Embeds</PageHeaderTitle>
            <PageHeaderDescription>
              Generate a snippet or feed for sessions, speakers, the agenda, the itinerary, or the
              gallery.
            </PageHeaderDescription>
          </PageHeaderContent>
        </PageHeader>
        <form
          className="grid max-w-md gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <Field>
            <FieldLabel htmlFor="embed-name">Name</FieldLabel>
            <Input
              id="embed-name"
              value={name}
              onChange={(change) => setName(change.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="embed-kind">Widget type</FieldLabel>
            <NativeSelect
              id="embed-kind"
              value={kind}
              onChange={(change) => setKind(change.target.value as (typeof EMBED_KINDS)[number])}
            >
              {EMBED_KINDS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="embed-format">Format</FieldLabel>
            <NativeSelect
              id="embed-format"
              value={format}
              onChange={(change) =>
                setFormat(change.target.value as (typeof EMBED_FORMATS)[number])
              }
            >
              {EMBED_FORMATS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" pending={create.isPending}>
            Save embed
          </Button>
        </form>
        {(embeds.data ?? []).length === 0 && !embeds.isPending ? (
          <EmptyState
            title="No embeds yet"
            description="Save a widget to get a snippet or feed for another site."
          />
        ) : (
          <div className="grid gap-3">
            {(embeds.data ?? []).map((embed) => (
              <Item key={embed.id} variant="outline" className="items-start">
                <ItemContent>
                  <ItemTitle>
                    {embed.name} · {embed.kind} · {embed.format} ·{' '}
                    {embed.enabled ? 'enabled' : 'disabled'}
                  </ItemTitle>
                  <ItemDescription>Get code</ItemDescription>
                  <div
                    data-slot="embed-builder"
                    className="mt-2 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                  >
                    <div className="grid gap-2">
                      <Textarea
                        className="font-mono text-xs md:text-xs"
                        readOnly
                        rows={3}
                        value={embed.snippet}
                        aria-label={`${embed.name} embed code`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-slot="embed-copy"
                        className="self-start"
                        onClick={() => {
                          void navigator.clipboard.writeText(embed.snippet)
                        }}
                      >
                        Copy iframe
                      </Button>
                    </div>
                    {embed.format === 'html' ? (
                      <iframe
                        data-slot="embed-live-preview"
                        title={`${embed.name} live preview`}
                        src={embedPreviewHref(
                          typeof window === 'undefined' ? '' : window.location.origin,
                          embed.id,
                        )}
                        className="min-h-80 w-full rounded-md border border-border bg-background"
                      />
                    ) : null}
                  </div>
                </ItemContent>
                <ItemActions>
                  <a
                    className={buttonVariants({ variant: 'link', size: 'sm' })}
                    href={`/embed/${embed.id}`}
                  >
                    Preview
                  </a>
                </ItemActions>
              </Item>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
