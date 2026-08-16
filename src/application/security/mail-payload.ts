import { normalizeEmail } from '../../domain/invariants/email'

export type EmailDeliveryMode = 'capture' | 'resend-test' | 'resend-live'

export interface MailPayloadKey {
  readonly keyVersion: string
  /** Standard padded Base64 encoding of exactly 32 random bytes. */
  readonly keyMaterialBase64: string
}

export interface ProtectedMailPayload {
  readonly jobId: string
  readonly messageId: string
  readonly mode: EmailDeliveryMode
  readonly recipientFingerprint: string
  readonly recipientLabel: string
  readonly auditBody: string
  readonly keyVersion: string
  readonly nonce: string
  readonly ciphertext: string
  readonly expiresAt: string
}

interface MailPayloadInput {
  readonly jobId: string
  readonly messageId: string
  readonly mode: EmailDeliveryMode
  readonly to: string
  readonly subject: string
  readonly body: string
  readonly expiresAt: string
}

export interface DecryptedMailPayload {
  readonly to: string
  readonly subject: string
  readonly body: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('Invalid mail payload key')
  let decoded: string
  try {
    decoded = atob(value)
  } catch {
    throw new Error('Invalid mail payload key')
  }
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length))
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  if (bytes.byteLength !== 32) throw new Error('Invalid mail payload key')
  return bytes
}

async function deriveAesKey(key: MailPayloadKey): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    decodeBase64(key.keyMaterialBase64),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('open-events-mail-v1'),
      info: encoder.encode('payload-encryption'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function deriveFingerprintKey(key: MailPayloadKey): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    decodeBase64(key.keyMaterialBase64),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('open-events-mail-v1'),
      info: encoder.encode('recipient-fingerprint'),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  )
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  try {
    const decoded = atob(padded)
    const bytes = new Uint8Array(new ArrayBuffer(decoded.length))
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index)
    }
    return bytes
  } catch {
    throw new Error('Invalid protected mail payload')
  }
}

function additionalData(input: {
  readonly jobId: string
  readonly messageId: string
  readonly mode: EmailDeliveryMode
  readonly keyVersion: string
}): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `open-events-mail-v1\n${input.jobId}\n${input.messageId}\n${input.mode}\n${input.keyVersion}`,
  )
}

export function redactEmailAddress(value: string): string {
  const normalized = normalizeEmail(value)
  const separator = normalized.lastIndexOf('@')
  if (separator <= 0) return 'redacted-recipient'
  const local = normalized.slice(0, separator)
  const domain = normalized.slice(separator + 1)
  return `${local.slice(0, 1)}***@${domain}`
}

export async function fingerprintMailRecipient(
  value: string,
  key: MailPayloadKey,
): Promise<string> {
  const hmac = await deriveFingerprintKey(key)
  const digest = await crypto.subtle.sign(
    'HMAC',
    hmac,
    encoder.encode(`open-events-recipient-v1\n${normalizeEmail(value)}`),
  )
  return `v1:${encodeBase64Url(new Uint8Array(digest))}`
}

export async function protectMailPayload(
  input: MailPayloadInput,
  key: MailPayloadKey,
): Promise<ProtectedMailPayload> {
  if (key.keyVersion.trim() === '' || key.keyVersion !== key.keyVersion.trim()) {
    throw new Error('Invalid mail payload key version')
  }
  const expiry = Date.parse(input.expiresAt)
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== input.expiresAt) {
    throw new Error('Invalid mail payload expiry')
  }
  const normalizedRecipient = normalizeEmail(input.to)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await deriveAesKey(key)
  const plaintext = encoder.encode(
    JSON.stringify({ to: normalizedRecipient, subject: input.subject, body: input.body }),
  )
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: additionalData({ ...input, keyVersion: key.keyVersion }),
      tagLength: 128,
    },
    aesKey,
    plaintext,
  )
  return {
    jobId: input.jobId,
    messageId: input.messageId,
    mode: input.mode,
    recipientFingerprint: await fingerprintMailRecipient(normalizedRecipient, key),
    recipientLabel: redactEmailAddress(normalizedRecipient),
    auditBody: 'Message content is protected in the encrypted delivery job.',
    keyVersion: key.keyVersion,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
    expiresAt: input.expiresAt,
  }
}

export async function decryptMailPayload(
  payload: ProtectedMailPayload,
  key: MailPayloadKey,
): Promise<DecryptedMailPayload> {
  if (payload.keyVersion !== key.keyVersion) throw new Error('Unknown mail payload key version')
  const aesKey = await deriveAesKey(key)
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decodeBase64Url(payload.nonce),
      additionalData: additionalData(payload),
      tagLength: 128,
    },
    aesKey,
    decodeBase64Url(payload.ciphertext),
  )
  const decoded: unknown = JSON.parse(decoder.decode(plaintext))
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    !('to' in decoded) ||
    !('subject' in decoded) ||
    !('body' in decoded) ||
    typeof decoded.to !== 'string' ||
    typeof decoded.subject !== 'string' ||
    typeof decoded.body !== 'string'
  ) {
    throw new Error('Invalid protected mail payload')
  }
  return { to: decoded.to, subject: decoded.subject, body: decoded.body }
}
