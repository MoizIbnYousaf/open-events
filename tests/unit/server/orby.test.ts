import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOpenRouterOrby, selectOrbyReplyer } from '../../../src/server/orby'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Orby OpenRouter adapter', () => {
  it('stays quiet when no key is configured', async () => {
    const orby = selectOrbyReplyer({})
    await expect(orby.reply({ eventName: 'DemoConf 2026', history: [] })).resolves.toBeNull()
  })

  it('posts history to OpenRouter and returns the assistant text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'The CFP is still open.' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const orby = createOpenRouterOrby({ apiKey: 'test-key', model: 'openai/gpt-5.6-luna' })
    const reply = await orby.reply({
      eventName: 'DemoConf 2026',
      history: [{ role: 'user', content: 'Is the CFP open?' }],
    })
    expect(reply).toBe('The CFP is still open.')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { model: string; messages: { role: string }[] }
    expect(body.model).toBe('openai/gpt-5.6-luna')
    expect(body.messages[0]?.role).toBe('system')
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-key' })
  })

  it('swallows a refused OpenRouter call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })))
    const orby = createOpenRouterOrby({ apiKey: 'test-key', model: 'openai/gpt-5.6-luna' })
    await expect(orby.reply({ eventName: 'DemoConf 2026', history: [] })).resolves.toBeNull()
  })
})
