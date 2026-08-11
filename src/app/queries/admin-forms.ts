import { useQuery } from '@tanstack/react-query'

import { useServerMutation } from '../../../adapters/tanstack-react-query'

import {
  getFormDraft,
  getFormVersionDetail,
  listFormVersions,
  publishForm,
  updateFormDraft,
} from '../api/admin-forms'
import type { SaveFormDraftInput } from '../../application'
import type { EventSlug, FormId, VersionId } from '../../domain'

export const adminFormQueryKeys = {
  draft: (formId: FormId) => ['admin', 'forms', formId, 'draft'] as const,
  versions: (formId: FormId) => ['admin', 'forms', formId, 'versions'] as const,
  version: (formId: FormId, versionId: VersionId) =>
    ['admin', 'forms', formId, 'version', versionId] as const,
}

export function useFormDraft(slug: EventSlug | undefined, formId: FormId | undefined) {
  return useQuery({
    queryKey: adminFormQueryKeys.draft(formId ?? ''),
    queryFn: () => getFormDraft(slug as EventSlug, formId as FormId),
    enabled: slug !== undefined && formId !== undefined,
  })
}

export function useFormVersions(slug: EventSlug | undefined, formId: FormId | undefined) {
  return useQuery({
    queryKey: adminFormQueryKeys.versions(formId ?? ''),
    queryFn: () => listFormVersions(slug as EventSlug, formId as FormId),
    enabled: slug !== undefined && formId !== undefined,
  })
}

export function useFormVersionDetail(
  slug: EventSlug | undefined,
  formId: FormId | undefined,
  versionId: VersionId | undefined,
) {
  return useQuery({
    queryKey: adminFormQueryKeys.version(formId ?? '', versionId ?? ''),
    queryFn: () =>
      getFormVersionDetail(slug as EventSlug, formId as FormId, versionId as VersionId),
    enabled: slug !== undefined && formId !== undefined && versionId !== undefined,
  })
}

export function useUpdateFormDraft(slug: EventSlug, formId: FormId) {
  return useServerMutation({
    mutationFn: (input: SaveFormDraftInput) => updateFormDraft(slug, formId, input),
  })
}

export function usePublishForm(slug: EventSlug, formId: FormId) {
  return useServerMutation({
    mutationFn: () => publishForm(slug, formId),
  })
}
