import { useEffect, useRef } from 'react'

import { turnstileSiteKey } from '../../../lib/turnstile'

const SCRIPT_ID = 'cloudflare-turnstile-script'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
  render(
    element: HTMLElement,
    options: {
      readonly sitekey: string
      readonly action: string
      readonly callback: (token: string) => void
      readonly 'expired-callback': () => void
      readonly 'error-callback': () => void
    },
  ): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export default function TurnstileWidget({
  onToken,
  resetKey,
}: {
  readonly onToken: (token: string) => void
  readonly resetKey: number
}) {
  const sitekey = turnstileSiteKey()
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sitekey === undefined) return
    let disposed = false
    let widgetId: string | null = null
    const render = () => {
      if (
        disposed ||
        widgetId !== null ||
        container.current === null ||
        window.turnstile === undefined
      ) {
        return
      }
      widgetId = window.turnstile.render(container.current, {
        sitekey,
        action: 'public_start',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      })
    }
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing !== null) {
      if (window.turnstile !== undefined) render()
      else existing.addEventListener('load', render, { once: true })
    } else {
      const script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      script.addEventListener('load', render, { once: true })
      document.head.appendChild(script)
    }
    return () => {
      disposed = true
      if (widgetId !== null) window.turnstile?.remove(widgetId)
    }
  }, [onToken, resetKey, sitekey])

  if (sitekey === undefined) return null
  return <div ref={container} aria-label="Human verification" />
}
