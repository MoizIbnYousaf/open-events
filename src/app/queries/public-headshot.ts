import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import { HEADSHOT_CONTENT_TYPES, HEADSHOT_MAX_BYTES } from '../../application/services/headshots'
import type { HeadshotDto } from '../../application/dtos/headshot.dto'
import { ApiClientError } from '../api/admin-events'

export const publicHeadshotQueryKeys = {
  own: ['public', 'headshot', 'own'] as const,
}

/** Own headshot bytes as an object URL, or null when none is stored yet. */
export interface OwnHeadshot {
  readonly blob: Blob
  readonly contentType: string
}

export interface OwnHeadshotView {
  readonly objectUrl: string
  readonly contentType: string
}

async function toApiError(response: Response): Promise<ApiClientError> {
  const body: unknown = await response.json().catch(() => null)
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const code = typeof error?.code === 'string' ? error.code : 'internal'
  const message = typeof error?.message === 'string' ? error.message : 'Request failed'
  return new ApiClientError(code, message, response.status)
}

/** GET /api/public/profile/headshot — 404 means "no headshot yet", not an error. */
export async function getOwnHeadshot(): Promise<OwnHeadshot | null> {
  const response = await fetch('/api/public/profile/headshot', { credentials: 'include' })
  if (response.status === 404) return null
  if (!response.ok) throw await toApiError(response)
  const blob = await response.blob()
  return {
    blob,
    contentType: response.headers.get('content-type') ?? blob.type,
  }
}

/** PUT /api/public/profile/headshot — raw bytes with the file's content type. */
export async function putOwnHeadshot(file: File): Promise<HeadshotDto> {
  const response = await fetch('/api/public/profile/headshot', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': file.type },
    body: await file.arrayBuffer(),
  })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as HeadshotDto
}

export function useOwnHeadshot() {
  const query = useQuery({
    queryKey: publicHeadshotQueryKeys.own,
    queryFn: getOwnHeadshot,
    retry: false,
  })
  const blob = query.data?.blob
  const contentType = query.data?.contentType
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (blob === undefined) return
    const url = URL.createObjectURL(blob)
    let committed = true
    queueMicrotask(() => {
      if (committed) setObjectUrl(url)
    })
    return () => {
      committed = false
      URL.revokeObjectURL(url)
    }
  }, [blob])
  return {
    ...query,
    data:
      objectUrl === undefined || contentType === undefined
        ? query.data === null
          ? null
          : undefined
        : { objectUrl, contentType },
  }
}

export function useUploadHeadshot() {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (file: File) => putOwnHeadshot(file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: publicHeadshotQueryKeys.own })
    },
  })
}

/** Client-side mirror of the server envelope; the server still fails closed. */
export function describeHeadshotRejection(file: File): string | null {
  if (!HEADSHOT_CONTENT_TYPES.some((allowed) => allowed === file.type)) {
    return 'Choose a JPEG, PNG, or WebP image.'
  }
  if (file.size === 0) {
    return 'That file is empty — choose an image with content.'
  }
  if (file.size > HEADSHOT_MAX_BYTES) {
    return 'Choose an image of 2 MB or less.'
  }
  return null
}
