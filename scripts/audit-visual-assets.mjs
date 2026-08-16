#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const VISUAL_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])

export const APPROVED_VISUAL_ASSETS = Object.freeze([
  'public/apple-touch-icon.png',
  'public/favicon.svg',
  'public/images/open-events-stage.png',
  'public/logo-lockup.svg',
  'public/logo.png',
  'public/logo.svg',
  'public/og/logo-sheet.png',
  'public/og/open-events.png',
  'public/og/orby.png',
  'public/session-stage.jpg',
  'public/speakers-conversation.jpg',
  'public/washes/conference-hero-dark.jpg',
  'public/washes/grain-dark.jpg',
  'public/washes/grain-light.jpg',
  'public/washes/mesh-dark.jpg',
  'public/washes/mesh-light.jpg',
])

function walk(directory, root, found = []) {
  if (!existsSync(directory)) return found
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name)
    if (statSync(path).isDirectory()) walk(path, root, found)
    else if (VISUAL_EXTENSIONS.has(extname(name).toLowerCase())) {
      found.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  return found
}

export function shippedVisualAssets(root) {
  return walk(resolve(root, 'public'), root).sort()
}

export function auditVisualAssets(root, approvedAssets = APPROVED_VISUAL_ASSETS) {
  const shipped = shippedVisualAssets(root)
  const approved = new Set(approvedAssets)
  const errors = []
  for (const path of shipped) {
    if (!approved.has(path)) errors.push(`${path}: visual asset is not approved`)
  }
  for (const path of approved) {
    if (!shipped.includes(path)) errors.push(`${path}: approved asset is missing`)
  }
  return errors.sort()
}

export function runVisualAssetAudit(root = process.cwd()) {
  return auditVisualAssets(root)
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const errors = runVisualAssetAudit()
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    process.exit(1)
  }
  console.log(
    `visual asset audit passed — ${shippedVisualAssets(process.cwd()).length} reviewed assets`,
  )
}
