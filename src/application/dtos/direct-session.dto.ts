import type { SubmissionId } from '../../domain'

export interface CreateDirectSessionInput {
  readonly requestId: string
  readonly speakerContactId: string
  readonly title: string
  readonly abstract: string
  readonly formatId: string
  readonly trackId: string | null
  readonly durationMinutes: number
  readonly notes: string
}

export interface DirectSessionReceiptDto {
  readonly submissionId: SubmissionId
  readonly created: boolean
}
