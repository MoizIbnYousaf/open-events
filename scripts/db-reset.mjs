#!/usr/bin/env node
// Local-only D1 reset: wipe .wrangler/state, apply migrations --local, seed --local.
import { rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const stateDir = resolve(root, '.wrangler', 'state')

const run = (args) => {
  const result = spawnSync('pnpm', ['exec', ...args], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (existsSync(stateDir)) {
  rmSync(stateDir, { recursive: true, force: true })
  console.log('db:reset — local D1 state wiped')
} else {
  console.log('db:reset — no local state to wipe')
}

run(['wrangler', 'd1', 'migrations', 'apply', 'speakerops-m1-local', '--local'])
run(['wrangler', 'd1', 'execute', 'speakerops-m1-local', '--local', '--file', 'src/db/seed.sql'])
console.log('db:reset — migrations applied and DemoConf 2026 seed executed (local only)')
