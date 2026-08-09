import { useMutation, useQuery } from '@tanstack/react-query'

import {
  getFormDraft,
  getFormVersionDetail,
  listFormVersions,
  publishForm,
  updateFormDraft,
} from '../api/admin-forms'
import type { SaveFormDraftInput } from '../../application'
import type { FormId, VersionId } from '../../domain'

export const adminFormQueryKeys = {
  draft: (formId: FormId) => ['admin', 'forms', formId, 'draft'] as const,
  versions: (formId: FormId) => ['admin', 'forms', formId, 'versions'] as const,
  version: (formId: FormId, versionId: VersionId) =>
    ['admin', 'forms', formId, 'version', versionId] as const,
}

export function useFormDraft(formId: FormId | undefined) {
  return useQuery({
    queryKey: adminFormQueryKeys.draft(formId ?? ''),
    queryFn: () => getFormDraft(formId as FormId),
    enabled: formId !== undefined,
  })
}

export function useFormVersions(formId: FormId | undefined) {
  return useQuery({
    queryKey: adminFormQueryKeys.versions(formId ?? ''),
    queryFn: () => listFormVersions(formId as FormId),
    enabled: formId !== undefined,
  })
}

export function useFormVersionDetail(formId: FormId | undefined, versionId: VersionId | undefined) {
  return useQuery({
    queryKey: adminFormQueryKeys.version(formId ?? '', versionId ?? ''),
    queryFn: () => getFormVersionDetail(formId as FormId, versionId as VersionId),
    enabled: formId !== undefined && versionId !== undefined,
  })
}

export function useUpdateFormDraft(formId: FormId) {
  return useMutation({
    mutationFn: (input: SaveFormDraftInput) => updateFormDraft(formId, input),
  })
}

export function usePublishForm(formId: FormId) {
  return useMutation({
    mutationFn: () => publishForm(formId),
  })
}
