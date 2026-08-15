import { describe, expect, it } from 'vitest'

import {
  CONFIRMATION_SUBJECT_TEMPLATE,
  renderConfirmationEmail,
} from '../../../src/application/services/confirmation-email'

describe('renderConfirmationEmail', () => {
  it('renders the default receipt with the proposal title and id', () => {
    expect(
      renderConfirmationEmail({
        title: 'My talk',
        eventName: 'DemoConf 2026',
        submissionId: 'sub-1',
      }),
    ).toEqual({
      subject: CONFIRMATION_SUBJECT_TEMPLATE,
      body: 'Open Events: your submission "My talk" was received (sub-1).',
    })
  })

  it('uses organizer templates when they are set', () => {
    expect(
      renderConfirmationEmail(
        { title: 'My talk', eventName: 'DemoConf 2026', submissionId: 'sub-1' },
        {
          subject: '{{eventName}}: we got "{{title}}"',
          body: 'Thanks. Ref {{submissionId}}.',
        },
      ),
    ).toEqual({
      subject: 'DemoConf 2026: we got "My talk"',
      body: 'Thanks. Ref sub-1.',
    })
  })
})
