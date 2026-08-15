#!/usr/bin/env node
// Renders scripts/og/card.html to the committed 1200x630 social image.
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '../..')
const card = resolve(root, 'scripts/og/card.html')
const out = resolve(root, 'public/og/open-events.png')

mkdirSync(dirname(out), { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
})
await page.goto(pathToFileURL(card).href, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
const tmp = resolve(root, 'public/og/.open-events@2x.png')
await page.locator('.card').screenshot({ path: tmp, type: 'png' })
await browser.close()

const magick = spawnSync(
  'magick',
  [tmp, '-strip', '-resize', '1200x630', '-depth', '8', '-define', 'png:compression-level=9', out],
  { stdio: 'inherit' },
)
rmSync(tmp, { force: true })
if (magick.status !== 0) process.exit(magick.status ?? 1)
console.log(`og:render — wrote ${out}`)
