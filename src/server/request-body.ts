/** True when the client declares a body that already exceeds the budget. */
export function declaresOversizeBody(contentLength: string | undefined, maxBytes: number): boolean {
  if (contentLength === undefined) return false
  const declared = Number(contentLength)
  return Number.isFinite(declared) && declared > maxBytes
}

/** Reads and materializes at most `maxBytes`, cancelling an oversize stream. */
export async function readCappedBody(
  request: Request,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const body = request.body
  if (body === null) return new ArrayBuffer(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}
