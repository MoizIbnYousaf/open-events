/** Token hashing seam; only hashes are persisted (never raw tokens). */
export interface TokenHasher {
  hash(token: string): Promise<string>
}

/** Secure random token generation seam (crypto.randomUUID adapter). */
export interface TokenGenerator {
  generate(): Promise<string>
}
