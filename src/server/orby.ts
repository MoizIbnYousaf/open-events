import { ORBY_NAME } from '../domain/support'
import type { OrbyReplyer } from '../application/ports/orby-replyer'

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.6-luna'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

interface OpenRouterMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

interface OpenRouterResponse {
  readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[]
}

function systemPrompt(eventName: string): string {
  return [
    `You are ${ORBY_NAME}, support for ${eventName} on Open Events.`,
    'Help with the call for papers, review, speaker portal, agenda, and public schedule.',
    'Keep replies short. Do not invent unpublished sessions, scores, or decisions.',
    'If you do not know, say so and point the person at the organizer desk.',
  ].join(' ')
}

function readContent(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (!Array.isArray(value)) return null
  const parts = value.flatMap((part) => {
    if (typeof part === 'string') return [part]
    if (typeof part === 'object' && part !== null && 'text' in part) {
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? [text] : []
    }
    return []
  })
  const joined = parts.join('').trim()
  return joined.length > 0 ? joined : null
}

export function createOpenRouterOrby(config: {
  readonly apiKey: string
  readonly model: string
}): OrbyReplyer {
  return {
    async reply(input) {
      const messages: OpenRouterMessage[] = [
        { role: 'system', content: systemPrompt(input.eventName) },
        ...input.history.map((turn) => ({
          role: turn.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: turn.content,
        })),
      ]
      try {
        const response = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            'http-referer': 'https://openevents.engineer',
            'x-title': 'Open Events Orby',
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature: 0.4,
          }),
        })
        if (!response.ok) {
          console.warn(`orby openrouter refused with ${response.status}`)
          return null
        }
        const body = (await response.json()) as OpenRouterResponse
        return readContent(body.choices?.[0]?.message?.content ?? null)
      } catch (error) {
        console.warn('orby openrouter failed', error)
        return null
      }
    },
  }
}

export function selectOrbyReplyer(env: {
  readonly OPENROUTER_API_KEY?: string
  readonly OPENROUTER_MODEL?: string
}): OrbyReplyer {
  const apiKey = env.OPENROUTER_API_KEY
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return {
      async reply() {
        return null
      },
    }
  }
  const model =
    typeof env.OPENROUTER_MODEL === 'string' && env.OPENROUTER_MODEL.length > 0
      ? env.OPENROUTER_MODEL
      : DEFAULT_OPENROUTER_MODEL
  return createOpenRouterOrby({ apiKey, model })
}
