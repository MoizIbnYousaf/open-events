import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'

/**
 * Launch and shutdown contract for the organizer end-to-end dev server.
 *
 * The wrapper has to be able to stop the server it started. A signal it cannot
 * pass on leaves a listener on the port after the wrapper is gone: the next
 * organizer run refuses to start (its config never reuses an existing server)
 * and the default end-to-end run silently attaches to that stale server
 * instead of one of its own. Two rules prevent that.
 *
 * 1. The child IS the dev server. Running it through a package manager puts a
 *    process in between that does not forward SIGTERM, so the signal stops at
 *    the wrapper and the server keeps serving.
 * 2. A child that does not go away in time is killed outright, so shutdown
 *    always terminates rather than waiting on an exit that never comes.
 */

/** Grace period before an unresponsive dev server is killed outright. */
export const SHUTDOWN_GRACE_MS = 5_000

/**
 * `node <vite binary>` for the dev server, so the spawned child is the process
 * that has to receive the shutdown signal.
 */
/**
 * Local `.env.local` may hold an optional Clerk publishable key. Vite would
 * load it and pull clerk-js into the judged e2e path. An empty override wins
 * over the file so the gate stays the no-Clerk judged surface.
 */
export function e2eServerEnv(baseEnv = process.env) {
  return { ...baseEnv, VITE_CLERK_PUBLISHABLE_KEY: '' }
}

export function devServerCommand(root, port) {
  const require = createRequire(resolve(root, 'package.json'))
  const viteBin = resolve(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
  return {
    command: process.execPath,
    args: [viteBin, '--port', String(port), '--strictPort'],
  }
}

/**
 * Signals a child and resolves once it is gone, escalating to SIGKILL when the
 * grace period passes.
 *
 * Resolves with what actually ended the child: the requested signal,
 * `'SIGKILL'` after an escalation, or `'already-exited'` when there was
 * nothing left to stop.
 */
export function terminateChild(child, signal, graceMs = SHUTDOWN_GRACE_MS) {
  return new Promise((settle) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      settle('already-exited')
      return
    }
    let outcome = signal
    const escalation = setTimeout(() => {
      outcome = 'SIGKILL'
      child.kill('SIGKILL')
    }, graceMs)
    child.once('exit', () => {
      clearTimeout(escalation)
      settle(outcome)
    })
    child.kill(signal)
  })
}
