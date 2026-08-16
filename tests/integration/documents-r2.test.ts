import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import migration0008Sql from '../../migrations/0008_create_uploaded_files_table.sql?raw'
import migration0014Sql from '../../migrations/0014_widen_uploaded_file_kinds.sql?raw'
import app from '../../src/server'
import { applyMigrations, seedDemoConf, splitSqlStatements } from './m2b-helpers'
import { ALLOWED_ORIGIN, bindings, cookieHeader, submitterPortalCookie } from './m2c-helpers'

// O3 P2 (REQ-007): a speaker uploads and retrieves one persisted supporting
// document through R2 with an explicit content-type allow-list (pdf/plain
// text), a 5 MiB bound, and a length-bounded sanitized display filename
// carried in an explicit header — never a trusted path. Owner-only access;
// migration 0014 widens the frozen 0008 kind/content-type CHECKs while
// preserving existing headshot rows byte for byte.

const DOCUMENT_URL = '/api/public/profile/document'
const HEADSHOT_URL = '/api/public/profile/headshot'
const DOCUMENT_MAX = 5 * 1024 * 1024

beforeEach(async () => {
  await reset()
  await applyMigrations(env.DB)
  await applyD1Migrations(env.DB, [
    { name: '0008_create_uploaded_files_table.sql', queries: splitSqlStatements(migration0008Sql) },
    {
      name: '0014_widen_uploaded_file_kinds.sql',
      queries: splitSqlStatements(migration0014Sql),
    },
  ])
  await seedDemoConf(env.DB)
})

function bytes(length: number): ArrayBuffer {
  return new Uint8Array(length).fill(7).buffer
}

async function putDocument(
  cookie: string,
  body: ArrayBuffer,
  contentType = 'application/pdf',
  fileName = 'slides-outline.pdf',
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return app.request(
    DOCUMENT_URL,
    {
      method: 'PUT',
      headers: {
        cookie: cookieHeader(cookie),
        origin: ALLOWED_ORIGIN,
        'content-type': contentType,
        'x-file-name': fileName,
        ...extraHeaders,
      },
      body,
    },
    bindings(),
  )
}

async function getDocument(cookie: string): Promise<Response> {
  return app.request(DOCUMENT_URL, { headers: { cookie: cookieHeader(cookie) } }, bindings())
}

describe('migration 0014', () => {
  it('widens the kind check and preserves an existing headshot row', async () => {
    // The migration ran in beforeEach; prove a document row is insertable and
    // a headshot row still is too, and that the frozen 0008 image rules were
    // not silently applied to documents (5 MiB pdf allowed).
    const speaker = await submitterPortalCookie(env.DB)
    const headshot = await app.request(
      HEADSHOT_URL,
      {
        method: 'PUT',
        headers: {
          cookie: cookieHeader(speaker),
          origin: ALLOWED_ORIGIN,
          'content-type': 'image/png',
        },
        body: bytes(64),
      },
      bindings(),
    )
    expect(headshot.status).toBe(200)
    const document = await putDocument(speaker, bytes(64))
    expect(document.status).toBe(200)
    const rows = await env.DB.prepare(
      'SELECT kind, COUNT(*) AS n FROM uploaded_files GROUP BY kind ORDER BY kind',
    ).all<{ kind: string; n: number }>()
    expect(rows.results).toEqual([
      { kind: 'document', n: 1 },
      { kind: 'headshot', n: 1 },
    ])
  })
})

describe('document upload validation', () => {
  it('accepts pdf and plain text within bounds and reports safe metadata', async () => {
    const speaker = await submitterPortalCookie(env.DB)
    const response = await putDocument(speaker, bytes(1024), 'application/pdf', 'notes v2.pdf')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      contentType: string
      sizeBytes: number
      fileName: string
    }
    expect(body.contentType).toBe('application/pdf')
    expect(body.sizeBytes).toBe(1024)
    expect(body.fileName).toBe('notes v2.pdf')
    expect(JSON.stringify(body)).not.toMatch(/events\//)

    const text = await putDocument(speaker, bytes(16), 'text/plain', 'abstract.txt')
    expect(text.status).toBe(200)
  })

  it('rejects disallowed types, empty bodies, and oversize uploads', async () => {
    const speaker = await submitterPortalCookie(env.DB)
    expect((await putDocument(speaker, bytes(16), 'application/zip')).status).toBe(415)
    expect((await putDocument(speaker, bytes(16), 'text/html')).status).toBe(415)
    expect((await putDocument(speaker, bytes(0))).status).toBe(400)
    expect(
      (
        await putDocument(speaker, bytes(16), 'application/pdf', 'a.pdf', {
          'content-length': String(DOCUMENT_MAX + 1),
        })
      ).status,
    ).toBe(413)
    expect((await putDocument(speaker, bytes(DOCUMENT_MAX + 1))).status).toBe(413)
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM uploaded_files').first<{
      n: number
    }>()
    expect(count?.n).toBe(0)
  })

  it('rejects unsafe or over-long filenames and requires one', async () => {
    const speaker = await submitterPortalCookie(env.DB)
    expect(
      (await putDocument(speaker, bytes(16), 'application/pdf', '../../etc/passwd')).status,
    ).toBe(400)
    expect((await putDocument(speaker, bytes(16), 'application/pdf', 'a/b.pdf')).status).toBe(400)
    expect((await putDocument(speaker, bytes(16), 'application/pdf', 'a\\b.pdf')).status).toBe(400)
    // Control characters cannot travel in an HTTP header at all (the fetch
    // layer refuses them), so that rejection is pinned at the service level in
    // tests/unit/application/documents.test.ts rather than here.
    expect(
      (await putDocument(speaker, bytes(16), 'application/pdf', 'x'.repeat(201) + '.pdf')).status,
    ).toBe(400)
    expect((await putDocument(speaker, bytes(16), 'application/pdf', '')).status).toBe(400)
  })
})

describe('document ownership and retrieval', () => {
  it('serves the own document back and replaces it atomically', async () => {
    const speaker = await submitterPortalCookie(env.DB)
    await putDocument(speaker, bytes(64), 'application/pdf', 'v1.pdf')
    await putDocument(speaker, bytes(128), 'text/plain', 'v2.txt')

    const read = await getDocument(speaker)
    expect(read.status).toBe(200)
    expect(read.headers.get('content-type')).toContain('text/plain')
    expect(read.headers.get('content-disposition')).toBe('attachment; filename="v2.txt"')
    expect(read.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await read.arrayBuffer()).byteLength).toBe(128)

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM uploaded_files WHERE kind = 'document'",
    ).first<{ n: number }>()
    expect(rows?.n).toBe(1)
    const versions = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM uploaded_file_versions WHERE kind = 'document'",
    ).first<{ n: number }>()
    expect(versions?.n).toBe(1)
    const objects = await env.FILES.list()
    expect(objects.objects.filter((object) => object.key.includes('/document/'))).toHaveLength(2)
    const current = await getDocument(speaker)
    expect((await current.arrayBuffer()).byteLength).toBe(128)
  })

  it('denies another speaker access to the stored document', async () => {
    const ada = await submitterPortalCookie(env.DB)
    await putDocument(ada, bytes(64))
    const grace = await submitterPortalCookie(env.DB, {}, 'speaker.grace@example.test')
    const denied = await getDocument(grace)
    expect(denied.status).toBe(404)
  })

  it('rejects anonymous uploads and reads', async () => {
    const anonymousPut = await app.request(
      DOCUMENT_URL,
      {
        method: 'PUT',
        headers: {
          origin: ALLOWED_ORIGIN,
          'content-type': 'application/pdf',
          'x-file-name': 'a.pdf',
        },
        body: bytes(16),
      },
      bindings(),
    )
    expect(anonymousPut.status).toBe(401)
    const anonymousGet = await app.request(DOCUMENT_URL, undefined, bindings())
    expect(anonymousGet.status).toBe(401)
  })
})
