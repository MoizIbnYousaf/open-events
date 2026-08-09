import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const APP_ROOT = join(__dirname, '..', '..', '..', 'src', 'app')

function readAppSource(fileName: string): string {
  return readFileSync(join(APP_ROOT, fileName), 'utf8')
}

describe('root query provider ownership contract', () => {
  it('main.tsx owns exactly one QueryClientProvider wrapping RouterProvider with the shared QueryClient', () => {
    const mainSource = readAppSource('main.tsx')

    expect(mainSource).toContain("import { QueryClientProvider } from '@tanstack/react-query'")
    expect(mainSource).toContain("import { queryClient } from './query-client'")
    expect(mainSource).toContain('<QueryClientProvider client={queryClient}>')
    expect(mainSource).toContain('<RouterProvider router={router} />')
    expect(mainSource.match(/<QueryClientProvider/g)?.length ?? 0).toBe(1)
    expect(mainSource).toMatch(
      /<QueryClientProvider[^>]*client=\{queryClient\}[^>]*>[\s\S]*<RouterProvider[^>]*\/>/,
    )
  })

  it('query-client.ts exports a shared QueryClient with retry disabled', () => {
    const queryClientSource = readAppSource('query-client.ts')

    expect(queryClientSource).toContain('export const queryClient')
    expect(queryClientSource).toContain('retry: false')
  })

  it.each([
    ['EventConfig', join('features', 'admin', 'EventConfig.tsx')],
    ['TaxonomyEditor', join('features', 'admin', 'TaxonomyEditor.tsx')],
    ['BuilderEditor', join('features', 'builder', 'BuilderEditor.tsx')],
    ['VersionDetail', join('features', 'builder', 'VersionDetail.tsx')],
  ] as const)('%s does not self-wrap with AdminQueryProvider', (_name, fileName) => {
    const screenSource = readAppSource(fileName)

    expect(screenSource).not.toContain('import { AdminQueryProvider }')
    expect(screenSource).not.toContain('AdminQueryProvider')
    expect(screenSource).not.toContain(
      "import { QueryClientProvider } from '@tanstack/react-query'",
    )
  })
})
