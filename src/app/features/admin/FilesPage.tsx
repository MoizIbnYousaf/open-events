import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { requestJson } from '../../api/admin-events'
import { Button } from '../../../components/ui/button'
import { Checkbox } from '../../../components/ui/checkbox'
import { EmptyState } from '../../../components/ui/empty-state'
import { Input } from '../../../components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '../../../components/ui/item'
import { buttonVariants } from '../../../components/ui/button-variants'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '../../../components/ui/page-header'
import AppShell from '../nav/AppShell'
import { versionApprovalTrail } from './file-versions'

interface FileRow {
  readonly id: string
  readonly ownerContactId: string
  readonly ownerName: string
  readonly kind: string
  readonly fileName: string
  readonly updatedAt: string
  readonly versionCount: number
  readonly sessionTitle: string
}

export default function FilesPage({ eventSlug }: { readonly eventSlug: string }) {
  const client = useQueryClient()
  const [selected, setSelected] = useState<readonly string[]>([])
  const selectedSet = new Set(selected)
  const files = useQuery({
    queryKey: ['admin', 'files', eventSlug],
    queryFn: () => requestJson<readonly FileRow[]>(`/api/admin/events/${eventSlug}/files`),
  })
  const zip = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/events/${eventSlug}/files/zip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ownerContactIds: selected }),
      })
      if (!response.ok) throw new Error('zip failed')
      return response.blob()
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'files.zip'
      link.click()
      URL.revokeObjectURL(url)
      void client.invalidateQueries({ queryKey: ['admin', 'files', eventSlug] })
    },
  })

  useEffect(() => {
    document.title = 'Files — Open Events'
  }, [])

  return (
    <AppShell slug={eventSlug}>
      <div className="mx-auto grid w-full max-w-3xl gap-4" data-tour="files-workspace">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderTitle>Files</PageHeaderTitle>
            <PageHeaderDescription>
              Every upload on this event, with version counts. Export the latest copies as a ZIP.
            </PageHeaderDescription>
          </PageHeaderContent>
          <PageHeaderActions>
            <Button type="button" size="sm" pending={zip.isPending} onClick={() => zip.mutate()}>
              Download ZIP of latest versions
            </Button>
          </PageHeaderActions>
        </PageHeader>
        {(files.data ?? []).length === 0 && !files.isPending ? (
          <EmptyState
            title="No files yet"
            description="Uploads from speakers appear here. Export the latest copies as a ZIP once they land."
          />
        ) : (
          <div className="grid gap-2">
            {(files.data ?? []).map((file) => (
              <Item key={file.id} variant="outline">
                <ItemMedia>
                  <Checkbox
                    aria-label={`Select ${file.fileName}`}
                    checked={selectedSet.has(file.ownerContactId)}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, file.ownerContactId]
                          : current.filter((id) => id !== file.ownerContactId),
                      )
                    }}
                  />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{file.fileName}</ItemTitle>
                  <ItemDescription>
                    {file.ownerName} · {file.sessionTitle} · {file.kind} · {file.versionCount}{' '}
                    versions · {file.updatedAt}
                  </ItemDescription>
                  <FileExtras eventSlug={eventSlug} file={file} />
                </ItemContent>
                <ItemActions>
                  <a
                    className={buttonVariants({ variant: 'link', size: 'sm' })}
                    href={`/api/admin/events/${eventSlug}/files/${file.ownerContactId}/${file.kind}`}
                  >
                    Download
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

function FileExtras({ eventSlug, file }: { readonly eventSlug: string; readonly file: FileRow }) {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const versions = useQuery({
    enabled: open,
    queryKey: ['admin', 'file-versions', eventSlug, file.ownerContactId, file.kind],
    queryFn: () =>
      requestJson<
        readonly { version: number; fileName: string; current: boolean; createdAt: string }[]
      >(`/api/admin/events/${eventSlug}/files/${file.ownerContactId}/${file.kind}/versions`),
  })
  const comments = useQuery({
    enabled: open,
    queryKey: ['admin', 'file-comments', eventSlug, file.ownerContactId, file.kind],
    queryFn: () =>
      requestJson<readonly { authorName: string; body: string; createdAt: string }[]>(
        `/api/admin/events/${eventSlug}/files/${file.ownerContactId}/${file.kind}/comments`,
      ),
  })
  const addComment = useMutation({
    mutationFn: () =>
      requestJson(
        `/api/admin/events/${eventSlug}/files/${file.ownerContactId}/${file.kind}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ body: comment, authorName: 'Organizer' }),
        },
      ),
    onSuccess: () => {
      setComment('')
      void comments.refetch()
    },
  })
  return (
    <div className="mt-2 grid gap-2">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto justify-self-start px-0"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide versions and comments' : 'Versions and comments'}
      </Button>
      {open ? (
        <>
          <p className="text-xs text-muted-foreground">
            Approval trail: {versionApprovalTrail(versions.data ?? []) || 'none yet'}
          </p>
          <ul className="text-xs">
            {(versions.data ?? []).map((row) => (
              <li key={`${row.version}-${row.createdAt}`}>
                v{row.version} {row.fileName} {row.current ? '(current)' : ''} · {row.createdAt}
              </li>
            ))}
          </ul>
          <ul className="text-xs">
            {(comments.data ?? []).map((row) => (
              <li key={`${row.createdAt}-${row.body}`}>
                {row.authorName} · {row.createdAt}: {row.body}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              className="h-8 grow text-xs"
              value={comment}
              placeholder="Comment on this file"
              onChange={(event) => setComment(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              pending={addComment.isPending}
              onClick={() => addComment.mutate()}
            >
              Add comment
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
