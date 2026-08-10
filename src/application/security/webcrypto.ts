import type { TokenGenerator, TokenHasher } from '../ports/token-ports'

export function createSha256TokenHasher(): TokenHasher {
  return {
    async hash(token: string): Promise<string> {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
      return toHex(digest)
    },
  }
}

export function createUuidTokenGenerator(): TokenGenerator {
  return {
    async generate(): Promise<string> {
      return crypto.randomUUID()
    },
  }
}

/**
 * Constant-time equality of two arbitrary secret strings (NOT hex). The
 * comparison of the two fixed 32-byte SHA-256 digests is full-loop and
 * fixed-work: every digest byte is XOR-accumulated with no early
 * prefix/mismatch return, so the comparison itself leaks nothing about input
 * prefix or equality. NOTE: SHA-256 processing itself scales with input
 * length, so this helper does NOT make hashing arbitrary inputs independent
 * of length — its constant-time guarantee covers the digest comparison, not
 * the input hashing cost. Safe on Workers without nodejs_compat.
 */
export async function constantTimeSecretEqual(a: string, b: string): Promise<boolean> {
  const digestA = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)))
  const digestB = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)))
  let diff = 0
  for (let i = 0; i < digestA.length; i += 1) {
    diff |= (digestA[i] ?? 0) ^ (digestB[i] ?? 0)
  }
  return diff === 0
}

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
