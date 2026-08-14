import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// @ts-expect-error — scripts/golden-dev-child.mjs is plain ESM (narrow documented boundary).
import { devServerCommand, terminateChild } from '../../../scripts/golden-dev-child.mjs'

// Shutdown contract for the organizer end-to-end dev server: a signal the
// wrapper cannot pass on leaves a listener on the port after the wrapper is
// gone, which blocks the next organizer run and silently feeds the default run
// a stale server. Both halves are exercised here — the child is the dev server
// itself, and a child that ignores the signal is still stopped.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * A child that outlives the test unless something stops it.
 *
 * It is handed back only once it has announced itself, so a signal can never
 * arrive before the script under test has installed its own handler.
 */
async function longRunningChild(script: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', `${script}\nconsole.log('ready')`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const stdout = child.stdout
  if (stdout === null) throw new Error('child stdout was not piped')
  await new Promise<void>((settle) => {
    stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) settle()
    })
  })
  return child
}

describe('golden dev server launch command', () => {
  it('runs the dev server itself, with no package manager in between', () => {
    const { command, args } = devServerCommand(REPO_ROOT, 4173)

    // A package-manager parent is what swallows the shutdown signal, so the
    // command is the Node binary running the dev server directly.
    expect(command).toBe(process.execPath)
    expect(existsSync(args[0])).toBe(true)
    expect(args.slice(1)).toEqual(['--port', '4173', '--strictPort'])
  })
})

describe('golden dev server shutdown', () => {
  it('stops a child that honours the signal', async () => {
    const child = await longRunningChild('setInterval(() => {}, 1000)')

    await expect(terminateChild(child, 'SIGTERM', 5000)).resolves.toBe('SIGTERM')
    expect(child.signalCode).toBe('SIGTERM')
  })

  it('kills a child that ignores the signal once the grace period passes', async () => {
    const child = await longRunningChild(
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    )

    await expect(terminateChild(child, 'SIGTERM', 200)).resolves.toBe('SIGKILL')
    expect(child.signalCode).toBe('SIGKILL')
  })

  it('resolves right away when the child is already gone', async () => {
    const child = await longRunningChild('')
    await new Promise((settle) => child.once('exit', settle))

    await expect(terminateChild(child, 'SIGTERM', 200)).resolves.toBe('already-exited')
  })
})
