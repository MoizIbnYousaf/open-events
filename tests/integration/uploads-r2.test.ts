import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import migration0008Sql from '../../migrations/0008_create_uploaded_files_table.sql?raw'
import migration0014Sql from '../../migrations/0014_widen_uploaded_file_kinds.sql?raw'
import { HEADSHOT_MAX_BYTES } from '../../src/application'
import app from '../../src/server'
import { applyMigrations, seedDemoConf, splitSqlStatements } from './m2b-helpers'
import { ALLOWED_ORIGIN, bindings, cookieHeader, submitterPortalCookie } from './m2c-helpers'

const HEADSHOT_URL = '/api/public/profile/headshot'
const CHUNK_BYTES = 64 * 1024
const STREAM_CAP_BYTES = HEADSHOT_MAX_BYTES * 4

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    { name: '0008_create_uploaded_files_table.sql', queries: splitSqlStatements(migration0008Sql) },
    { name: '0014_widen_uploaded_file_kinds.sql', queries: splitSqlStatements(migration0014Sql) },
  ])
  await seedDemoConf(env.DB)
})

function pixels(length: number): ArrayBuffer {
  return new Uint8Array(length).fill(9).buffer
}

async function putHeadshot(
  cookie: string,
  body: ArrayBuffer,
  contentType = 'image/png',
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(
    HEADSHOT_URL,
    {
      method: 'PUT',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': contentType,
        ...headers,
      },
      body,
    },
    bindings(),
  )
}

async function countUploadedFiles(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM uploaded_files').first<{
    count: number
  }>()
  return row?.count ?? 0
}

async function countObjects(): Promise<number> {
  const listing = await env.FILES.list()
  return listing.objects.length
}

describe('public headshot uploads (R2 + D1)', () => {
  it('round-trips an upload through PUT and GET for the owning submitter', async () => {
    const cookie = await submitterPortalCookie(env.DB)

    const put = await putHeadshot(cookie, pixels(64))
    expect(put.status).toBe(200)
    expect(await put.json()).toMatchObject({ contentType: 'image/png', sizeBytes: 64 })

    const get = await app.request(
      HEADSHOT_URL,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await get.arrayBuffer())).toHaveLength(64)
    expect(await countUploadedFiles()).toBe(1)
    expect(await countObjects()).toBe(1)
  })

  it('rejects an oversize upload with 413 and writes nothing', async () => {
    const cookie = await submitterPortalCookie(env.DB)

    const response = await putHeadshot(cookie, pixels(HEADSHOT_MAX_BYTES + 1))

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })
    expect(await countUploadedFiles()).toBe(0)
    expect(await countObjects()).toBe(0)
  })

  it('rejects an empty body as a 400 validation failure, not as oversize', async () => {
    const cookie = await submitterPortalCookie(env.DB)

    const response = await putHeadshot(cookie, pixels(0))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })
    expect(await countUploadedFiles()).toBe(0)
    expect(await countObjects()).toBe(0)
  })

  it('rejects a declared oversize body with 413 before reading it', async () => {
    const cookie = await submitterPortalCookie(env.DB)
    let pulledBytes = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulledBytes >= STREAM_CAP_BYTES) {
          controller.close()
          return
        }
        pulledBytes += CHUNK_BYTES
        controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(9))
      },
    })

    const response = await app.request(
      new Request(`https://app.test${HEADSHOT_URL}`, {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'image/png',
          'content-length': String(HEADSHOT_MAX_BYTES * 64),
        },
        body,
        duplex: 'half',
      } as RequestInit),
      undefined,
      bindings(),
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })
    // Only the stream's own prefetch chunk is ever produced: the handler
    // short-circuits on the declared length and never reads the body.
    expect(pulledBytes).toBeLessThanOrEqual(CHUNK_BYTES)
    expect(await countUploadedFiles()).toBe(0)
    expect(await countObjects()).toBe(0)
  })

  it('stops reading an undeclared body once it passes the frozen budget', async () => {
    const cookie = await submitterPortalCookie(env.DB)
    let pulledBytes = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulledBytes >= STREAM_CAP_BYTES) {
          controller.close()
          return
        }
        pulledBytes += CHUNK_BYTES
        controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(9))
      },
    })

    const response = await app.request(
      new Request(`https://app.test${HEADSHOT_URL}`, {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(cookie),
          origin: ALLOWED_ORIGIN,
          'content-type': 'image/png',
        },
        body,
        duplex: 'half',
      } as RequestInit),
      undefined,
      bindings(),
    )

    expect(response.status).toBe(413)
    expect(pulledBytes).toBeLessThanOrEqual(HEADSHOT_MAX_BYTES + CHUNK_BYTES)
    expect(await countUploadedFiles()).toBe(0)
    expect(await countObjects()).toBe(0)
  })

  it('rejects an unsupported content type with 415 and writes nothing', async () => {
    const cookie = await submitterPortalCookie(env.DB)

    const response = await putHeadshot(cookie, pixels(32), 'application/pdf')

    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({
      error: { code: 'validation_failed', message: 'Validation failed' },
    })
    expect(await countUploadedFiles()).toBe(0)
    expect(await countObjects()).toBe(0)
  })

  it('never serves another submitter headshot', async () => {
    const owner = await submitterPortalCookie(env.DB)
    await putHeadshot(owner, pixels(64))
    const other = await submitterPortalCookie(env.DB, {}, 'speaker-b@example.test')

    const response = await app.request(
      HEADSHOT_URL,
      { headers: { cookie: cookieHeader(other) } },
      bindings(),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Not found' },
    })
  })

  it('keeps exactly one metadata row and one object after a replacement', async () => {
    const cookie = await submitterPortalCookie(env.DB)

    expect((await putHeadshot(cookie, pixels(64))).status).toBe(200)
    expect((await putHeadshot(cookie, pixels(128), 'image/jpeg')).status).toBe(200)

    expect(await countUploadedFiles()).toBe(1)
    expect(await countObjects()).toBe(1)
    const get = await app.request(
      HEADSHOT_URL,
      { headers: { cookie: cookieHeader(cookie) } },
      bindings(),
    )
    expect(get.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await get.arrayBuffer())).toHaveLength(128)
  })

  it('fails closed for anonymous and cross-origin requests', async () => {
    const cookie = await submitterPortalCookie(env.DB)

    const anonymous = await app.request(HEADSHOT_URL, undefined, bindings())
    expect(anonymous.status).toBe(401)

    const crossOrigin = await putHeadshot(cookie, pixels(64), 'image/png', {
      origin: 'https://evil.test',
    })
    expect(crossOrigin.status).toBe(403)
    expect(await countUploadedFiles()).toBe(0)
    expect(await countObjects()).toBe(0)
  })
})
