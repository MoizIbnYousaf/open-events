import { describe, expect, it } from 'vitest'

import { CapturedMessageService } from '../../../src/application'
import { EVENT_ID, NOW } from '../helpers/fixtures'
import { InMemoryCapturedMessageRepository } from '../helpers/in-memory-repositories'

function buildHarness() {
  const messages = new InMemoryCapturedMessageRepository()
  const service = new CapturedMessageService(messages)
  return { service, messages }
}

const stored = {
  id: 'message-1',
  eventId: EVENT_ID,
  toEmail: 'speaker.a@example.test',
  subject: 'Your Open Events CFP link',
  body: 'Open your CFP session: http://localhost/cfp/demo-conf-2026/cfp?token=demo-token',
  createdAt: NOW,
  kind: 'confirmation' as const,
}

describe('CapturedMessageService.listByEmail', () => {
  it('returns the stored record for the exact stored normalized email', async () => {
    const { service, messages } = buildHarness()
    await messages.save(stored)

    const found = await service.listByEmail('speaker.a@example.test')

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ id: 'message-1', toEmail: 'speaker.a@example.test' })
  })

  it('normalizes the query (trim + lowercase) before matching', async () => {
    const { service, messages } = buildHarness()
    await messages.save(stored)

    expect(await service.listByEmail('  Speaker.A@Example.TEST  ')).toHaveLength(1)
    expect(await service.listByEmail('SPEAKER.A@EXAMPLE.TEST')).toHaveLength(1)
  })

  it('returns empty for a non-matching normalized email', async () => {
    const { service, messages } = buildHarness()
    await messages.save(stored)

    expect(await service.listByEmail('other@example.test')).toEqual([])
  })

  it('requires an exact match, never prefix or contains semantics', async () => {
    const { service, messages } = buildHarness()
    await messages.save(stored)

    expect(await service.listByEmail('speaker')).toEqual([])
    expect(await service.listByEmail('speaker.a@example')).toEqual([])
    expect(await service.listByEmail('xspeaker.a@example.test')).toEqual([])
  })

  it('does not decide local-mode authorization (the API layer owns fail-closed)', async () => {
    const { service, messages } = buildHarness()
    await messages.save(stored)

    const found = await service.listByEmail('speaker.a@example.test')

    expect(found).toHaveLength(1)
    expect(found[0]?.body).toContain('token=demo-token')
  })
})
