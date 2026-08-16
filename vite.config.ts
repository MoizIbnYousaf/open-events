// Adapted from cloudflare-os (Apache-2.0) @ 1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592 — see THIRD_PARTY_NOTICES.md
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  build: {
    manifest: true,
  },
  // Keep dependency discovery scoped to the app entrypoint so unrelated
  // workspace directories are never treated as application entries.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    watch: {
      ignored: [
        '**/.worktrees/**',
        '**/.grok/**',
        '**/local/**',
        '**/research-understanding-plan/**',
        '**/project-goal/**',
      ],
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    TanStackRouterVite({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/app/routes',
      generatedRouteTree: './src/app/routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
    cloudflare(),
  ],
})
