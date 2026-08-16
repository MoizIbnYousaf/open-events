// Adapted from cloudflare-os (Apache-2.0) @ 1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592 — see THIRD_PARTY_NOTICES.md
import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'workers',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
      {
        define: {
          // Keep Clerk off the judged unit surfaces. .env.local must not pull
          // the Clerk chunk into AdminLogin / the site header during tests.
          'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(''),
          'import.meta.env.VITE_CLERK_ORGANIZER_POLICY_CONFIGURED': JSON.stringify(''),
          'import.meta.env.VITE_TURNSTILE_SITE_KEY': JSON.stringify(''),
        },
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./tests/setup/jsdom-browser-apis.ts'],
          include: ['tests/unit/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
