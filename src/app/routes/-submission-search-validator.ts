import type { SubmissionSearch, SubmissionSearchInput } from '../features/admin/submission-search'

/**
 * Eager route metadata carries parsed JSON without importing desk logic. Every
 * consumer normalizes through `parseSubmissionSearch`; the API validates again.
 */
export const submissionSearchValidator = {
  types: {
    input: undefined as unknown as SubmissionSearchInput,
    output: undefined as unknown as SubmissionSearch,
  },
  parse: (value: unknown) => value as SubmissionSearch,
}
