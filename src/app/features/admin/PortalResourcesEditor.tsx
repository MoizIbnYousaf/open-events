import { useState } from 'react'

import type { PortalResourceKind } from '../../../domain'
import { AlertLive } from '../../../components/ui/alert-live'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Checkbox } from '../../../components/ui/checkbox'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, FieldLabel } from '../../../components/ui/field'
import { Input } from '../../../components/ui/input'
import { NativeSelect } from '../../../components/ui/native-select'
import { StatusLive } from '../../../components/ui/status-live'
import { Textarea } from '../../../components/ui/textarea'
import {
  useAdminResources,
  useDeleteAdminResource,
  useReorderAdminResources,
  useSaveAdminResource,
} from '../../queries/admin-resources'

export default function PortalResourcesEditor({ eventSlug }: { readonly eventSlug: string }) {
  const query = useAdminResources(eventSlug)
  const save = useSaveAdminResource(eventSlug)
  const remove = useDeleteAdminResource(eventSlug)
  const reorder = useReorderAdminResources(eventSlug)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [kind, setKind] = useState<PortalResourceKind>('markdown')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [published, setPublished] = useState(false)

  const resetForm = () => {
    setEditingId(null)
    setKind('markdown')
    setTitle('')
    setBody('')
    setUrl('')
    setPublished(false)
  }

  const resources = query.data ?? []
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= resources.length) return
    const ids = resources.map((resource) => resource.id)
    const current = ids[index]
    const other = ids[target]
    if (current === undefined || other === undefined) return
    ids[index] = other
    ids[target] = current
    reorder.mutate(ids)
  }

  return (
    <section className="grid gap-3" aria-labelledby="speaker-resources-title">
      <div>
        <h2 id="speaker-resources-title" className="font-heading text-lg font-semibold">
          Speaker resources
        </h2>
        <p className="text-sm text-muted-foreground">
          Publish event-wide guides and links in the speaker portal. Raw HTML and embeds are not
          supported.
        </p>
      </div>
      {query.isError ? <AlertLive>Resources are unavailable right now.</AlertLive> : null}
      {query.isPending ? <StatusLive>Loading resources…</StatusLive> : null}
      {!query.isPending && resources.length === 0 ? (
        <EmptyState
          title="No speaker resources"
          description="Create a guide or event link below."
        />
      ) : (
        <div className="grid gap-2">
          {resources.map((resource, index) => (
            <Card key={resource.id}>
              <CardContent className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{resource.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {resource.kind} · {resource.published ? 'Published' : 'Draft'}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  Move up
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={index === resources.length - 1}
                  onClick={() => move(index, 1)}
                >
                  Move down
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(resource.id)
                    setKind(resource.kind)
                    setTitle(resource.title)
                    setBody(resource.body ?? '')
                    setUrl(resource.url ?? '')
                    setPublished(resource.published)
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => setDeleteId(resource.id)}
                >
                  Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="border-b">
          <CardTitle level={3}>{editingId === null ? 'Add resource' : 'Edit resource'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              save.mutate(
                {
                  id: editingId,
                  input:
                    kind === 'markdown'
                      ? { kind, title, body, published }
                      : { kind, title, url, published },
                },
                { onSuccess: resetForm },
              )
            }}
          >
            <Field>
              <FieldLabel htmlFor="resource-kind">Type</FieldLabel>
              <NativeSelect
                id="resource-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as PortalResourceKind)}
              >
                <option value="markdown">Guide</option>
                <option value="link">External link</option>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="resource-title">Title</FieldLabel>
              <Input
                id="resource-title"
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            {kind === 'markdown' ? (
              <Field>
                <FieldLabel htmlFor="resource-body">Markdown</FieldLabel>
                <Textarea
                  id="resource-body"
                  required
                  maxLength={20_000}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="resource-url">HTTPS or mailto URL</FieldLabel>
                <Input
                  id="resource-url"
                  required
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={published}
                onChange={(event) => setPublished(event.target.checked)}
              />
              Published to speakers
            </label>
            {save.isError ? <AlertLive>Could not save this resource.</AlertLive> : null}
            {reorder.isError ? (
              <AlertLive>Could not reorder resources. Reload and try again.</AlertLive>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" pending={save.isPending}>
                {editingId === null ? 'Add resource' : 'Save resource'}
              </Button>
              {editingId !== null ? (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel editing
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete speaker resource"
        description="This removes the resource from the organizer desk and every speaker portal. This cannot be undone."
        confirmLabel="Delete resource"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleteId === null) return
          remove.mutate(deleteId, { onSuccess: () => setDeleteId(null) })
        }}
      >
        {remove.isError ? <AlertLive>Could not delete this resource.</AlertLive> : null}
      </ConfirmDialog>
    </section>
  )
}
