import { describe, expect, it } from 'vitest'

import { SessionService } from '../../../src/application'
import {
  EVENT_ID,
  FIXED_NOW,
  FORM_ID,
  createSubmitterToken,
  eventFixture,
  ownerContact,
} from '../helpers/fixtures'
import {
  InMemoryCapturedMessageRepository,
  InMemoryContactRepository,
  InMemoryEventRepository,
  InMemoryFormRepository,
  InMemorySessionRepository,
  InMemoryTokenRepository,
} from '../helpers/in-memory-repositories'
import { InMemorySessionUnitOfWork } from '../helpers/in-memory-unit-of-work'

function buildService(
  tokens: InMemoryTokenRepository,
  events: InMemoryEventRepository,
  forms: InMemoryFormRepository,
) {
  const sessions = new InMemorySessionRepository()
  const contacts = new InMemoryContactRepository([ownerContact])
  const messages = new InMemoryCapturedMessageRepository()
  const unitOfWork = new InMemorySessionUnitOfWork({ tokens, sessions, messages, contacts })
  const hasher = {
    async hash(token: string): Promise<string> {
      return `hash:${token}`
    },
  }
  let nextToken = 0
  const tokenGenerator = {
    async generate(): Promise<string> {
      nextToken += 1
      return `token-${nextToken}`
    },
  }
  return new SessionService(
    tokens,
    sessions,
    contacts,
    events,
    forms,
    hasher,
    tokenGenerator,
    unitOfWork,
    { now: () => FIXED_NOW },
  )
}

describe('SessionService redeem resolution (FK-unreachable in the pool)', () => {
  it('returns not_found for a token whose event row is missing, with zero mutation', async () => {
    const tokens = new InMemoryTokenRepository()
    await tokens.save(
      createSubmitterToken({
        eventId: 'event-missing',
        formId: FORM_ID,
        tokenHash: 'hash:token-1',
      }),
    )
    const service = buildService(
      tokens,
      new InMemoryEventRepository(),
      new InMemoryFormRepository(),
    )

    await expect(service.redeemSubmitterToken('token-1', 60_000)).rejects.toMatchObject({
      code: 'not_found',
    })

    expect(tokens.list()[0]?.consumedAt).toBeNull()
  })

  it('returns not_found for a token whose form row is missing, with zero mutation', async () => {
    const tokens = new InMemoryTokenRepository()
    await tokens.save(
      createSubmitterToken({
        eventId: EVENT_ID,
        formId: 'form-missing',
        tokenHash: 'hash:token-1',
      }),
    )
    const service = buildService(
      tokens,
      new InMemoryEventRepository([eventFixture]),
      new InMemoryFormRepository(),
    )

    await expect(service.redeemSubmitterToken('token-1', 60_000)).rejects.toMatchObject({
      code: 'not_found',
    })

    expect(tokens.list()[0]?.consumedAt).toBeNull()
  })
})
