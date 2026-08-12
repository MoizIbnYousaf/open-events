import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearCfpDraftStash,
  readCfpDraftStash,
  stashCfpDraft,
} from '../../../src/app/queries/public-drafts'

/**
 * A visitor who fills the public call for papers and presses Save without a
 * speaker session is shown one honest page state — and used to lose every word
 * they had typed, because the wizard's editor lives in memory and the identity
 * detour navigates away from it. That is silent data loss, and a serious one:
 * the form invites four steps of work before it ever mentions signing in.
 *
 * The stash is what makes that detour a resumption. It mirrors the evaluator's
 * own draft stash — same storage, same tolerance for a storage-less browser —
 * and is keyed by form VERSION so a republished form never rehydrates answers
 * that belong to fields which no longer exist.
 */

const VERSION_A = 'f0000000-0000-4000-8000-000000000002'
const VERSION_B = 'f0000000-0000-4000-8000-0000000000ff'

class MemoryStorage {
  readonly #map = new Map<string, string>()
  get length(): number {
    return this.#map.size
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value)
  }
  removeItem(key: string): void {
    this.#map.delete(key)
  }
  clear(): void {
    this.#map.clear()
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  // One case deliberately poisons the getter to simulate disabled storage, so
  // teardown must not assume it can be read.
  try {
    window.sessionStorage.clear()
  } catch {
    /* storage-less browser case */
  }
})

describe('public CFP draft stash', () => {
  it('returns null when nothing was ever stashed', () => {
    expect(readCfpDraftStash(VERSION_A)).toBeNull()
  })

  it('round-trips the title, every answer and the step the visitor was on', () => {
    stashCfpDraft(VERSION_A, {
      title: 'Taming 40-Minute CI',
      answers: { title: 'Taming 40-Minute CI', format: 'talk', summary: 'Builds, but faster.' },
      stepIndex: 2,
    })

    expect(readCfpDraftStash(VERSION_A)).toEqual({
      title: 'Taming 40-Minute CI',
      answers: { title: 'Taming 40-Minute CI', format: 'talk', summary: 'Builds, but faster.' },
      stepIndex: 2,
    })
  })

  it('keeps drafts of different form versions apart', () => {
    stashCfpDraft(VERSION_A, { title: 'A', answers: { title: 'A' }, stepIndex: 1 })
    stashCfpDraft(VERSION_B, { title: 'B', answers: { title: 'B' }, stepIndex: 0 })

    expect(readCfpDraftStash(VERSION_A)?.title).toBe('A')
    expect(readCfpDraftStash(VERSION_B)?.title).toBe('B')
    clearCfpDraftStash(VERSION_A)
    expect(readCfpDraftStash(VERSION_A)).toBeNull()
    expect(readCfpDraftStash(VERSION_B)?.title).toBe('B')
  })

  it('survives the identity detour: stash, navigate away, read back on a fresh mount', () => {
    stashCfpDraft(VERSION_A, {
      title: 'Docs That Answer Back',
      answers: { title: 'Docs That Answer Back', format: 'workshop' },
      stepIndex: 1,
    })

    // A route change tears the wizard down; sessionStorage is what outlives it.
    const afterNavigation = readCfpDraftStash(VERSION_A)
    expect(afterNavigation?.answers).toEqual({
      title: 'Docs That Answer Back',
      format: 'workshop',
    })
  })

  it('tolerates a storage-less browser instead of breaking the form', () => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('storage disabled')
      },
      configurable: true,
    })

    expect(() => {
      stashCfpDraft(VERSION_A, { title: 'x', answers: {}, stepIndex: 0 })
    }).not.toThrow()
    expect(readCfpDraftStash(VERSION_A)).toBeNull()
    expect(() => {
      clearCfpDraftStash(VERSION_A)
    }).not.toThrow()
  })

  it('ignores corrupted or foreign-shaped stash content', () => {
    window.sessionStorage.setItem(`speakerops.cfp-draft.${VERSION_A}`, '{not json')
    expect(readCfpDraftStash(VERSION_A)).toBeNull()

    window.sessionStorage.setItem(
      `speakerops.cfp-draft.${VERSION_A}`,
      JSON.stringify({ title: 42, answers: 'nope', stepIndex: 'first' }),
    )
    expect(readCfpDraftStash(VERSION_A)).toBeNull()
  })

  it('drops the stash once the draft is genuinely saved', () => {
    stashCfpDraft(VERSION_A, { title: 'Saved', answers: { title: 'Saved' }, stepIndex: 0 })
    clearCfpDraftStash(VERSION_A)
    expect(readCfpDraftStash(VERSION_A)).toBeNull()
  })
})
