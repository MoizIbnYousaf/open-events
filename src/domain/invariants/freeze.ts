import type { CfpForm } from '../form.ts'
import type { FormVersion } from '../form-version.ts'

export const FREEZE_ISSUE_CODES = [
  'version_number',
  'published_without_hash',
  'published_without_date',
  'draft_with_published_at',
  'published_version_mismatch',
] as const

export type FreezeIssueCode = (typeof FREEZE_ISSUE_CODES)[number]

export interface FreezeIssue {
  readonly code: FreezeIssueCode
  readonly message: string
}

export function isVersionFrozen(version: FormVersion): boolean {
  return version.status === 'published'
}

export function canEditVersion(version: FormVersion): boolean {
  return version.status === 'draft'
}

export function isFormPublished(form: CfpForm): boolean {
  return form.status === 'published' && form.publishedVersionId !== null
}

/** A published version must carry its content hash and publish instant. */
export function validateVersionFreeze(version: FormVersion): readonly FreezeIssue[] {
  const issues: FreezeIssue[] = []
  if (!Number.isInteger(version.version) || version.version < 1) {
    issues.push({
      code: 'version_number',
      message: `Version number must be a positive integer (got ${version.version})`,
    })
  }
  if (version.status === 'published') {
    if (version.contentHash === null) {
      issues.push({
        code: 'published_without_hash',
        message: `Published version '${version.id}' has no content hash`,
      })
    }
    if (version.publishedAt === null) {
      issues.push({
        code: 'published_without_date',
        message: `Published version '${version.id}' has no published_at`,
      })
    }
  } else if (version.publishedAt !== null) {
    issues.push({
      code: 'draft_with_published_at',
      message: `Draft version '${version.id}' must not carry a published_at instant`,
    })
  }
  return issues
}

/** The form's published binding must point at a published version of itself. */
export function validatePublishedVersionBinding(
  form: CfpForm,
  publishedVersion: FormVersion,
): readonly FreezeIssue[] {
  const issues: FreezeIssue[] = []
  if (form.status !== 'published' || form.publishedVersionId === null) {
    issues.push({
      code: 'published_version_mismatch',
      message: `Form '${form.id}' is not published but a published version exists`,
    })
  } else if (publishedVersion.id !== form.publishedVersionId) {
    issues.push({
      code: 'published_version_mismatch',
      message: `Form '${form.id}' points at version '${form.publishedVersionId}' but got '${publishedVersion.id}'`,
    })
  } else if (publishedVersion.status !== 'published') {
    issues.push({
      code: 'published_version_mismatch',
      message: `Form '${form.id}' points at non-published version '${publishedVersion.id}'`,
    })
  }
  return issues
}

export const FORM_STATE_ISSUE_CODES = [
  'published_without_version',
  'draft_with_published_version',
] as const

export type FormStateIssueCode = (typeof FORM_STATE_ISSUE_CODES)[number]

export interface FormStateIssue {
  readonly code: FormStateIssueCode
  readonly message: string
}

/**
 * `cfp_forms` state invariant: `status = 'draft'` OR `published_version_id IS
 * NOT NULL`. A published form must point at its frozen version; a draft form
 * must not carry a pointer. (M2B backstops this with a CHECK constraint.)
 */
export function validateFormState(form: CfpForm): readonly FormStateIssue[] {
  if (form.status === 'published' && form.publishedVersionId === null) {
    return [
      {
        code: 'published_without_version',
        message: `Published form '${form.id}' must carry a published_version_id`,
      },
    ]
  }
  if (form.status === 'draft' && form.publishedVersionId !== null) {
    return [
      {
        code: 'draft_with_published_version',
        message: `Draft form '${form.id}' must not carry a published_version_id`,
      },
    ]
  }
  return []
}
