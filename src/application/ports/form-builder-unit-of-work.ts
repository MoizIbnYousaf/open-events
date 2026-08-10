import type { CfpForm, FormVersion, FormVersionContent } from '../../domain'

export type SaveDraftResult = { readonly outcome: 'saved' } | { readonly outcome: 'conflict' }

export type PublishResult = { readonly outcome: 'published' } | { readonly outcome: 'conflict' }

/**
 * Atomic form-builder writes. Implementations (the D1 adapter in `src/db`)
 * MUST persist each operation in a single batch so a draft version can never
 * exist without its content, and a publish can never leave the version frozen
 * without the form pointer update (or vice versa).
 *
 * Optimistic-concurrency preconditions (M2B implements them with guarded SQL):
 *
 * - `saveDraft`: when `expected` is null the version row must not exist (insert
 *   only); when `expected` is set the version row must still be `status =
 *   'draft'` AND `updated_at = expected.updatedAt`. Any mismatch returns
 *   `conflict` with zero writes.
 * - `publish`: the draft version must still be `status = 'draft'` AND
 *   `updated_at = expected.updatedAt`, and the form pointer must still equal
 *   `expectedForm.publishedVersionId` (null-safe comparison). Any mismatch
 *   returns `conflict` with zero writes.
 */
export interface FormBuilderUnitOfWork {
  saveDraft(input: {
    readonly expected: FormVersion | null
    readonly version: FormVersion
    readonly content: FormVersionContent
  }): Promise<SaveDraftResult>
  publish(input: {
    readonly expected: FormVersion
    readonly publishedVersion: FormVersion
    readonly expectedForm: CfpForm
    readonly form: CfpForm
  }): Promise<PublishResult>
}
