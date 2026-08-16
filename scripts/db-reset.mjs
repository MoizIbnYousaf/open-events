#!/usr/bin/env node
// Local-only D1 reset: wipe .wrangler/state, apply migrations --local, seed --local.
import { createRequire } from 'node:module'
import { rmSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const stateDir = resolve(root, '.wrangler', 'state')
// OPT-IN. The base seed is the minimal fixture a great many tests assert
// exactly, and the golden journeys assert ABSOLUTE row totals that a seeded
// proposal would silently inflate — so the demo programme is never the default.
const withShowcase = process.argv.includes('--showcase')
const withProgramme = process.argv.includes('--programme') || withShowcase

/**
 * `node <wrangler binary>` so a package-manager install check cannot block
 * the documented local reset / e2e webServer path.
 */
export function wranglerCommand(repoRoot) {
  const require = createRequire(resolve(repoRoot, 'package.json'))
  const wranglerBin = resolve(
    dirname(require.resolve('wrangler/package.json')),
    'bin',
    'wrangler.js',
  )
  return { command: process.execPath, wranglerBin }
}

const run = (args) => {
  const { command, wranglerBin } = wranglerCommand(root)
  const result = spawnSync(command, [wranglerBin, ...args], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  if (existsSync(stateDir)) {
    rmSync(stateDir, { recursive: true, force: true })
    console.log('db:reset — local D1 state wiped')
  } else {
    console.log('db:reset — no local state to wipe')
  }

  run(['d1', 'migrations', 'apply', 'open-events-production', '--local'])
  run(['d1', 'execute', 'open-events-production', '--local', '--file', 'src/db/seed.sql'])
  if (withProgramme) {
    run([
      'd1',
      'execute',
      'open-events-production',
      '--local',
      '--file',
      'src/db/seed-programme.sql',
    ])
  }
  if (withShowcase) {
    run([
      'd1',
      'execute',
      'open-events-production',
      '--local',
      '--file',
      'src/db/seed-showcase.sql',
    ])
  }
  console.log(
    withShowcase
      ? 'db:reset — migrations and the complete DemoConf showcase executed (local only)'
      : withProgramme
        ? 'db:reset — migrations, DemoConf 2026 seed and the demo programme executed (local only)'
        : 'db:reset — migrations applied and DemoConf 2026 seed executed (local only)',
  )
}
