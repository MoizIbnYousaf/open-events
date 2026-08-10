import type { Session, TokenHash, UtcInstant } from '../../domain'

export interface SessionRepository {
  save(session: Session): Promise<void>
  findByHash(tokenHash: TokenHash): Promise<Session | null>
  consumeByHash(tokenHash: TokenHash, consumedAt: UtcInstant): Promise<void>
}
