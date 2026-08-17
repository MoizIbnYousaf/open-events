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
    const body = JSON.parse(String(init.body)) as {
      max_tokens: number
      model: string
      messages: { role: string; content: string }[]
      temperature: number
    }
    expect(body.model).toBe('openai/gpt-5.6-luna')
    expect(body.messages[0]?.role).toBe('system')
    expect(body.messages[0]?.content).toContain('/start')
    expect(body.messages[0]?.content).toContain('/schedule/demo-conf-2026')
    expect(body.messages[0]?.content).toContain('Never ask for passwords')
    expect(body.max_tokens).toBe(240)
    expect(body.temperature).toBe(0.2)
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-key' })
  })

  it('bounds the conversation sent to OpenRouter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'How can I help?' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const orby = createOpenRouterOrby({ apiKey: 'test-key', model: 'openai/gpt-5.6-luna' })
    await orby.reply({
      eventName: 'DemoConf 2026',
      history: Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Turn ${index + 1}`,
      })),
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[] }
    expect(body.messages).toHaveLength(13)
    expect(body.messages[1]?.content).toBe('Turn 9')
    expect(body.messages.at(-1)?.content).toBe('Turn 20')
  })

  it('swallows a refused OpenRouter call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })))
    const orby = createOpenRouterOrby({ apiKey: 'test-key', model: 'openai/gpt-5.6-luna' })
    await expect(orby.reply({ eventName: 'DemoConf 2026', history: [] })).resolves.toBeNull()
  })
})
