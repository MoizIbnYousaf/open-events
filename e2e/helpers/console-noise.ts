/** Dev-server / optional-integration console noise excluded from user-facing errors. */
export const CONSOLE_NOISE_PATTERNS: readonly RegExp[] = [
  /^\[vite\]/,
  /Download the React DevTools/i,
  /Clerk has been loaded with development keys/i,
  /^Failed to execute 'postMessage' on 'DOMWindow': The target origin provided \('https:\/\/challenges\.cloudflare\.com'\) does not match the recipient window's origin /,
]

export function isConsoleNoise(text: string): boolean {
  return CONSOLE_NOISE_PATTERNS.some((pattern) => pattern.test(text))
}
