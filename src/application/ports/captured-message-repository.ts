import type { CapturedMessage } from '../../domain'

export interface CapturedMessageRepository {
  /** Dev/local endpoint only: lists captured messages for one normalized email. */
  listByEmail(email: string): Promise<readonly CapturedMessage[]>
}
