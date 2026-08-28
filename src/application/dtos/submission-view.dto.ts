import { z } from 'zod'

import { submissionDeskQuerySchema } from './submission-desk-query'

export const SUBMISSION_VIEW_SCHEMA_VERSION = 1 as const
export const MAX_SUBMISSION_VIEW_STATE_LENGTH = 8_192

export const submissionViewStateSchema = submissionDeskQuerySchema
  .omit({ page: true })
  .extend({ schemaVersion: z.literal(SUBMISSION_VIEW_SCHEMA_VERSION) })

export type SubmissionViewState = z.infer<typeof submissionViewStateSchema>

export interface SubmissionViewRecord {
  readonly eventId: string
  readonly id: string
  readonly name: string
  readonly state: SubmissionViewState
  readonly createdAt: string
  readonly updatedAt: string
}

export type SubmissionViewDto = SubmissionViewRecord

export function parseSubmissionViewState(value: unknown): SubmissionViewState {
  return submissionViewStateSchema.parse(value)
}
