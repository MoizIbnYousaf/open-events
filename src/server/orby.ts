import { ORBY_NAME } from '../domain/support'
import type { OrbyReplyer } from '../application/ports/orby-replyer'

export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5.6-luna'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_HISTORY_TURNS = 12

interface OpenRouterMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

interface OpenRouterResponse {
  readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[]
}

function systemPrompt(eventName: string, publicContext: string): string {
  return [
    `You are ${ORBY_NAME}, the friendly support assistant for ${eventName} on Open Events.`,
    'Give direct, practical answers in one or two short paragraphs.',
    'Useful routes: speaker access is /start; the CFP is /cfp/demo-conf-2026/cfp; the speaker portal is /portal; reviewer access is /evaluations; organizer access is /admin; the programme is /schedule/demo-conf-2026, /sessions/demo-conf-2026, and /speakers/demo-conf-2026.',
    'Explain the next step and include a relevant relative route when it helps.',
    'You cannot see private account data, unpublished sessions, scores, decisions, email delivery, or organizer actions. Never claim that you performed an action or that a private status is confirmed.',
    'Never ask for passwords, login codes, payment details, or API keys.',
    'If the answer depends on private event information, say what is missing and direct the person to the organizer. If the question is unclear, ask one short clarifying question.',
    publicContext.length > 0 ? `Current public event facts: ${publicContext}` : '',
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
        { role: 'system', content: systemPrompt(input.eventName, input.publicContext) },
        ...input.history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
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
            'user-agent': 'Open Events Orby/1.0 (+https://openevents.engineer)',
            'x-title': 'Open Events Orby',
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            max_tokens: 240,
            temperature: 0.2,
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
