import type { SubmitterToken, TokenHash } from '../../domain'

export interface TokenRepository {
  /**
   * Rows with `form_id IS NULL` are treated as absent (legacy fail-closed
   * 403); only rows with a non-null `form_id` decode into a valid
   * `SubmitterToken`.
   */
  findByHash(tokenHash: TokenHash): Promise<SubmitterToken | null>
}
