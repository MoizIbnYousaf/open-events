#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { devVarsContent, ownsDevVars } from './golden-dev-vars.mjs'

const root = resolve(import.meta.dirname, '..')
const devVarsPath = resolve(root, '.dev.vars')

let devVars
try {
  devVars = devVarsContent(process.env.LOCAL_ADMIN_TOKEN)
} catch (error) {
  console.error('golden-dev-server:', error instanceof Error ? error.message : String(error))
  process.exit(2)
}

if (existsSync(devVarsPath)) {
  const existing = readFileSync(devVarsPath, 'utf8')
  if (ownsDevVars(existing)) {
    rmSync(devVarsPath)
  } else {
    console.error(`golden-dev-server: refusing to overwrite ${devVarsPath}`)
    process.exit(2)
  }
}
writeFileSync(devVarsPath, devVars, { mode: 0o600 })

// Fresh D1 state before the Worker opens the database.
execFileSync(process.execPath, [resolve(root, 'scripts', 'db-reset.mjs')], {
  cwd: root,
  stdio: 'inherit',
})

const child = spawn('pnpm', ['dev', '--port', '4173', '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
})

const cleanup = () => {
  if (existsSync(devVarsPath) && ownsDevVars(readFileSync(devVarsPath, 'utf8'))) {
    rmSync(devVarsPath)
  }
}

const forward = (signal) => () => {
  cleanup()
  child.kill(signal)
}
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))
process.on('exit', cleanup)

child.on('exit', (code, signal) => {
  cleanup()
  process.exit(code ?? (signal !== null ? 1 : 0))
})
