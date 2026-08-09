import type { Session, TokenHash } from '../../domain'

export interface SessionRepository {
  save(session: Session): Promise<void>
  findByHash(tokenHash: TokenHash): Promise<Session | null>
}
