import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import type { DocumentDto, SpeakerProfileDto, UpdateProfileInput } from '../../application'
import { requestJson } from '../api/admin-events'
import { ApiClientError } from '../api/admin-events'

export const publicProfileQueryKeys = {
  profile: ['public', 'profile'] as const,
  document: ['public', 'document'] as const,
}

/** GET /api/public/profile — the calling speaker's persisted name/email/bio. */
export function getOwnProfile(): Promise<SpeakerProfileDto> {
  return requestJson('/api/public/profile')
}

/** PUT /api/public/profile — strict body; email is read-only identity. */
export function putOwnProfile(input: UpdateProfileInput): Promise<SpeakerProfileDto> {
  return requestJson('/api/public/profile', { method: 'PUT', body: JSON.stringify(input) })
}

export function useOwnProfile() {
  return useQuery({ queryKey: publicProfileQueryKeys.profile, queryFn: getOwnProfile })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (input: UpdateProfileInput) => putOwnProfile(input),
    onSuccess: (profile) => {
      queryClient.setQueryData(publicProfileQueryKeys.profile, profile)
      // Bio evidence gates the submit_bio task; the checklist rereads it.
      void queryClient.invalidateQueries({ queryKey: ['portal', 'tasks'] })
    },
  })
}

async function toApiError(response: Response): Promise<ApiClientError> {
  const body: unknown = await response.json().catch(() => null)
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const code = typeof error?.code === 'string' ? error.code : 'internal'
  const message = typeof error?.message === 'string' ? error.message : 'Request failed'
  return new ApiClientError(code, message, response.status)
}

/** GET /api/public/profile/document as JSON metadata. 404 is "none stored". */
export async function getOwnDocument(): Promise<DocumentDto | null> {
  const response = await fetch('/api/public/profile/document', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as DocumentDto
}

export function useOwnDocument() {
  return useQuery({ queryKey: publicProfileQueryKeys.document, queryFn: getOwnDocument })
}

/** PUT /api/public/profile/document — bytes plus the explicit x-file-name header. */
export async function putOwnDocument(file: File): Promise<DocumentDto> {
  const response = await fetch('/api/public/profile/document', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': file.type, 'x-file-name': file.name },
    body: await file.arrayBuffer(),
  })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as DocumentDto
}

export function useUploadDocument() {
  const queryClient = useQueryClient()
  return useServerMutation({
    mutationFn: (file: File) => putOwnDocument(file),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: publicProfileQueryKeys.document })
      await queryClient.invalidateQueries({ queryKey: ['public', 'document-versions'] })
    },
  })
}
