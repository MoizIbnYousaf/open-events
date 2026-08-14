#!/usr/bin/env node
// Remove build outputs so previews and size measurements only see current artifacts.
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
for (const path of ['dist']) {
  rmSync(resolve(root, path), { recursive: true, force: true })
}
console.log('clean — removed dist/')
