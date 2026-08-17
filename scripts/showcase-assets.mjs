import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { wranglerCommand } from './wrangler-command.mjs'

export const SHOWCASE_R2_PREFIX =
  'events/a1f6c0d4-6b1a-4f2e-9c3d-8e7f6a5b4c3d/contacts/d0000000-0000-4000-8000-000000000610'

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const inertDeck = Buffer.from(
  '%PDF-1.4\n% Open Events showcase deck\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
)

export const SHOWCASE_ASSETS = [
  {
    key: `${SHOWCASE_R2_PREFIX}/headshot/showcase-current`,
    contentType: 'image/png',
    body: transparentPng,
  },
  {
    key: `${SHOWCASE_R2_PREFIX}/document/showcase-current`,
    contentType: 'application/pdf',
    body: inertDeck,
  },
  {
    key: `${SHOWCASE_R2_PREFIX}/document/showcase-v1`,
    contentType: 'application/pdf',
    body: inertDeck,
  },
]

export function seedShowcaseAssets({ remote = false, repoRoot } = {}) {
  const root = repoRoot ?? resolve(import.meta.dirname, '..')
  const bucket = remote ? 'open-events-acceptance-files' : 'open-events-production-files'
  const { command, wranglerBin } = wranglerCommand(root)

  for (const asset of SHOWCASE_ASSETS) {
    const args = [
      wranglerBin,
      'r2',
      'object',
      'put',
      `${bucket}/${asset.key}`,
      remote ? '--remote' : '--local',
      '--pipe',
      '--content-type',
      asset.contentType,
      '--force',
    ]
    if (remote) args.push('--env', 'acceptance')
    const result = spawnSync(command, args, {
      cwd: root,
      input: asset.body,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
    if (result.status !== 0) {
      throw new Error(`Unable to seed showcase R2 object '${asset.key}'`)
    }
  }
}
