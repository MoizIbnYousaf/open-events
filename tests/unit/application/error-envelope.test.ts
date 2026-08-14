import { describe, expect, it } from 'vitest'

import { APPLICATION_ERROR_CODES, toApiErrorDto } from '../../../src/application'

describe('ApiErrorDto envelope', () => {
  it('produces the exact envelope shape', () => {
    expect(toApiErrorDto('not_found', 'Not found')).toEqual({
      error: { code: 'not_found', message: 'Not found' },
    })
  })

  it('uses only frozen application error codes', () => {
    expect(APPLICATION_ERROR_CODES).toEqual([
      'not_found',
      'validation_failed',
      'conflict',
      'unauthorized',
      'forbidden',
      'cfp_closed',
      'cfp_capped',
      'identity_limit_reached',
      'internal',
    ])
  })
})
