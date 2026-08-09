#!/usr/bin/env node
// Gate: shadcn/ui must be pinned to Base UI, and no foreign UI kits may exist.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const errors = []

const componentsPath = resolve(root, 'components.json')
if (!existsSync(componentsPath)) {
  errors.push('components.json missing')
} else {
  const components = JSON.parse(readFileSync(componentsPath, 'utf8'))
  const base = components.base ?? components.ui?.base
  const style = components.style ?? ''
  if (base !== 'base' && !style.startsWith('base-')) {
    errors.push(
      `components.json is not pinned to Base UI (base=${JSON.stringify(base)}, style=${JSON.stringify(style)})`,
    )
  }
}

const lockPath = resolve(root, 'pnpm-lock.yaml')
const lockText = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : ''
const foreign = [
  '@radix-ui/',
  'react-aria-components',
  '@react-aria/',
  '@mui/',
  '@chakra-ui/',
  '@mantine/',
  '@base-ui-components/',
]
for (const kit of foreign) {
  if (lockText.includes(kit)) errors.push(`foreign UI kit found in lockfile: ${kit}`)
}
if (!lockText.includes("'@base-ui/react'")) {
  errors.push('stable @base-ui/react not present in lockfile')
}

if (errors.length) {
  console.error('ui:check failed:\n' + errors.map((e) => ' - ' + e).join('\n'))
  process.exit(1)
}
console.log('ui:check ok — Base UI pinned, no foreign UI kits.')
