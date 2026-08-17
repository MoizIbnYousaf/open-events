import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('static shell cache policy', () => {
  it('forces every application entry route to fetch the current asset manifest', () => {
    const headers = readFileSync(resolve(import.meta.dirname, '../../../public/_headers'), 'utf8')
    for (const route of [
      '/',
      '/admin/*',
      '/cfp/*',
      '/schedule/*',
      '/sessions/*',
      '/speakers/*',
      '/start',
      '/portal',
      '/headshot',
      '/evaluations',
    ]) {
      expect(headers).toContain(`${route}\n  Cache-Control: no-store`)
    }
  })
})
