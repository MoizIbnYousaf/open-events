import { describe, expect, it } from 'vitest'

import {
  decryptMailPayload,
  protectMailPayload,
} from '../../../src/application/security/mail-payload'

const KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='

describe('mail payload protection', () => {
  it('keeps recipient and bearer content out of the immutable audit fields', async () => {
    const protectedPayload = await protectMailPayload(
      {
        jobId: 'job-1',
        messageId: 'message-1',
        mode: 'capture',
        to: 'Speaker.One@Example.test',
        subject: 'Your private link',
        body: 'Open https://www.openevents.engineer/start?token=super-secret',
        expiresAt: '2026-08-16T00:00:00.000Z',
      },
      { keyVersion: 'v1', keyMaterialBase64: KEY },
    )

    expect(protectedPayload.recipientLabel).toBe('s***@example.test')
    expect(protectedPayload.auditBody).not.toContain('super-secret')
    expect(protectedPayload.auditBody).not.toContain('https://')
    expect(protectedPayload.ciphertext).not.toContain('Speaker.One')
    expect(protectedPayload.ciphertext).not.toContain('super-secret')

    await expect(
      decryptMailPayload(protectedPayload, { keyVersion: 'v1', keyMaterialBase64: KEY }),
    ).resolves.toEqual({
      to: 'speaker.one@example.test',
      subject: 'Your private link',
      body: 'Open https://www.openevents.engineer/start?token=super-secret',
    })
  })

  it('binds ciphertext to the job identity and key version', async () => {
    const protectedPayload = await protectMailPayload(
      {
        jobId: 'job-1',
        messageId: 'message-1',
        mode: 'resend-test',
        to: 'delivered@resend.dev',
        subject: 'Test',
        body: 'Body',
        expiresAt: '2026-08-16T00:00:00.000Z',
      },
      { keyVersion: 'v1', keyMaterialBase64: KEY },
    )

    await expect(
      decryptMailPayload(
        { ...protectedPayload, jobId: 'job-2' },
        { keyVersion: 'v1', keyMaterialBase64: KEY },
      ),
    ).rejects.toThrow()
  })
})
