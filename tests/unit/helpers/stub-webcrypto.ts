import { webcrypto } from 'node:crypto'

import { afterAll, beforeAll, vi } from 'vitest'

/** jsdom's Crypto lacks `subtle`; use Node's WebCrypto where hashing is needed. */
export function installNodeWebCrypto(): void {
  beforeAll(() => {
    vi.stubGlobal('crypto', webcrypto)
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })
}
