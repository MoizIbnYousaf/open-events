import type { AnswerMap } from '../domain/answers'
import { answerText } from '../domain/programme'

/** The CFP answers a reviewer needs on the same job as the score. */
export function proposalAnswersForReview(answers: AnswerMap | null | undefined): {
  readonly abstract: string
  readonly track: string
  readonly takeaway: string
} {
  const map = answers ?? {}
  return {
    abstract: answerText(map.abstract),
    track: answerText(map.track),
    takeaway: answerText(map.takeaway ?? map.key_takeaway),
  }
}
