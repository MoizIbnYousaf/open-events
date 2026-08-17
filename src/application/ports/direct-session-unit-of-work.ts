import type { AnswerMap, EventId, SpeakerTask, SubmissionId, UtcInstant } from '../../domain'

export interface DirectSessionBatchInput {
  readonly eventId: EventId
  readonly formId: string
  readonly versionId: string
  readonly requestId: string
  readonly submissionId: SubmissionId
  readonly speakerContactId: string
  readonly title: string
  readonly answers: AnswerMap
  readonly contentHash: string
  readonly submittedAt: UtcInstant
  readonly decisionId: string
  readonly tasks: readonly SpeakerTask[]
  readonly session: {
    readonly day: string
    readonly start: UtcInstant
    readonly end: UtcInstant
    readonly trackId: string | null
  }
}

export interface DirectSessionBatchResult {
  readonly outcome: 'created' | 'existing' | 'conflict'
  readonly submissionId: SubmissionId | null
}

export interface DirectSessionUnitOfWork {
  execute(input: DirectSessionBatchInput): Promise<DirectSessionBatchResult>
}
