import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

/** Runs the pinned Wrangler binary directly so package-manager checks cannot block release scripts. */
export function wranglerCommand(repoRoot) {
  const require = createRequire(resolve(repoRoot, 'package.json'))
  const wranglerBin = resolve(
    dirname(require.resolve('wrangler/package.json')),
    'bin',
    'wrangler.js',
  )
  return { command: process.execPath, wranglerBin }
}
