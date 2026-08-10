export interface OrbyTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** Optional Orby brain. Null means stay quiet so a human can answer. */
export interface OrbyReplyer {
  reply(input: {
    readonly eventName: string
    readonly history: readonly OrbyTurn[]
  }): Promise<string | null>
}

export const silentOrbyReplyer: OrbyReplyer = {
  async reply() {
    return null
  },
}
