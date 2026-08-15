import { describe, expect, it } from 'vitest'

import { messageKindLabel } from '../../../src/domain/message-kind'

describe('messageKindLabel', () => {
  it('labels a submit receipt as Confirmation, not a sign-in link', () => {
    expect(messageKindLabel('confirmation', 'Your submission was received')).toBe('Confirmation')
  })

  it('still names a start-link confirmation a sign-in link', () => {
    expect(messageKindLabel('confirmation', 'Your Open Events CFP link')).toBe('Sign-in link')
  })

  it('labels acceptance and reminder in plain words', () => {
    expect(messageKindLabel('acceptance')).toBe('Acceptance')
    expect(messageKindLabel('reminder')).toBe('Reminder')
  })
})
