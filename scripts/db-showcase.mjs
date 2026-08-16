#!/usr/bin/env node
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const result = spawnSync(
  process.execPath,
  [resolve(root, 'scripts', 'db-reset.mjs'), '--showcase'],
  {
    cwd: root,
    stdio: 'inherit',
  },
)
process.exit(result.status ?? 1)
