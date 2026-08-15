import { describe, expect, it } from 'vitest'

import { isConsoleNoise } from '../../../e2e/helpers/console-noise'

describe('e2e console noise filter', () => {
  it('ignores Clerk development-key notices and keeps real errors', () => {
    expect(
      isConsoleNoise(
        'Clerk: Clerk has been loaded with development keys. Development instances have strict usage limits',
      ),
    ).toBe(true)
    expect(isConsoleNoise("[vite] connecting...")).toBe(true)
    expect(isConsoleNoise("Can't perform a React state update on a component that hasn't mounted yet.")).toBe(
      false,
    )
  })
})
