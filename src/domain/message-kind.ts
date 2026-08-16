/**
 * Plain words for a captured outbound kind.
 *
 * Confirmation is used for both CFP start links and submission receipts.
 * Labeling every confirmation "Sign-in link" misnames the receipt an
 * organizer is looking up when they ask "did that proposal actually land".
 */
export function messageKindLabel(kind: string, subject?: string): string {
  if (kind === 'acceptance') return 'Acceptance'
  if (kind === 'reminder') return 'Reminder'
  if (kind === 'confirmation') {
    if (subject !== undefined && /cfp link|sign-in|session link/i.test(subject)) {
      return 'Sign-in link'
    }
    return 'Confirmation'
  }
  return kind
}
