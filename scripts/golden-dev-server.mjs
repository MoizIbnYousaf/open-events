#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { devServerCommand, e2eServerEnv, terminateChild } from './golden-dev-child.mjs'
import { devVarsContent, installDevVars, restoreDevVars } from './golden-dev-vars.mjs'

/**
 * Dev server wrapper for the organizer end-to-end gate.
 *
 * It installs a local `.dev.vars` so the Worker has an admin token, resets D1,
 * and runs the dev server. The `.dev.vars` lifecycle is the important part: a
 * leaked file silently switches later local runs into local development mode,
 * so the previous state is snapshotted on the way in and replayed on every way
 * out — normal exit, non-zero exit, SIGINT/SIGTERM/SIGHUP, and an uncaught
 * exception. A run that is hard-killed before any handler can fire leaves the
 * snapshot behind, and the next run replays it before installing again.
 *
 * A signal also has to stop the server, not just restore the file: see
 * `golden-dev-child.mjs` for why the child is the dev server itself and why an
 * unresponsive one is killed rather than waited on.
 */
const root = resolve(import.meta.dirname, '..')
const PORT = 4173

let devVars
try {
  devVars = devVarsContent(process.env.LOCAL_ADMIN_TOKEN)
} catch (error) {
  console.error('golden-dev-server:', error instanceof Error ? error.message : String(error))
  process.exit(2)
}

const message = (error) => (error instanceof Error ? error.message : String(error))

const restore = () => {
  try {
    return restoreDevVars(root)
  } catch (error) {
    console.error('golden-dev-server: could not restore .dev.vars:', message(error))
    return 'failed'
  }
}

/** @type {import('node:child_process').ChildProcess | null} */
let child = null

// Registered before anything can throw, so no exit path skips the restore.
process.on('exit', restore)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restore()
    if (child === null) {
      process.exit(1)
    } else {
      void terminateChild(child, signal).then(() => {
        process.exit(1)
      })
    }
  })
}
process.on('uncaughtException', (error) => {
  console.error('golden-dev-server:', message(error))
  process.exit(1)
})

const snapshot = installDevVars(root, devVars)
if (snapshot.existed) {
  console.log('golden-dev-server: existing .dev.vars saved; it is restored on exit')
}

// Fresh D1 state before the Worker opens the database.
execFileSync(process.execPath, [resolve(root, 'scripts', 'db-reset.mjs')], {
  cwd: root,
  stdio: 'inherit',
})

const { command, args } = devServerCommand(root, PORT)
child = spawn(command, args, {
  cwd: root,
  stdio: 'inherit',
  env: e2eServerEnv(),
})

child.on('exit', (code, signal) => {
  restore()
  process.exit(code ?? (signal !== null ? 1 : 0))
})
