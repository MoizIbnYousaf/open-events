/** Dev-server / optional-integration console noise excluded from user-facing errors. */
export const CONSOLE_NOISE_PATTERNS: readonly RegExp[] = [
  /^\[vite\]/,
  /Download the React DevTools/i,
  /Clerk has been loaded with development keys/i,
]

export function isConsoleNoise(text: string): boolean {
  return CONSOLE_NOISE_PATTERNS.some((pattern) => pattern.test(text))
}
