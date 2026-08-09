# Third-Party Notices

This project selectively reuses implementation code from
[`cloudflare/cloudflare-os`](https://github.com/cloudflare/cloudflare-os) at
pinned commit `1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592`, licensed under the
Apache License 2.0. Kumo UI, gadget/RPC/gatekeeper/Durable Object product
architecture, and the monorepo shape are **not** reused.

The exact Apache License 2.0 text is distributed at [`./LICENSE`](./LICENSE)
(copied verbatim from the pinned donor commit).

Every donor-derived file must have an entry here **before** it is committed:

| Source path in donor (pinned commit)                     | Destination path     | Modifications                                                                                                                                                                                                                                                                                              | License    |
| -------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `packages/workshop-frontend/src/router.tsx`              | `src/app/router.tsx` | Adapted verbatim: same `createRouter` bootstrap (`scrollRestoration`, `defaultPreload`, `defaultPreloadStaleTime`) and `Register` module declaration                                                                                                                                                       | Apache-2.0 |
| `packages/workshop-frontend/vite.config.ts`              | `vite.config.ts`     | Adapted: `TanStackRouterVite({ target: 'react', autoCodeSplitting: true })` plugin pattern and plugin order; added `routesDirectory`, `tailwindcss()`, `cloudflare()`; uses Vite 8 native `resolve.tsconfigPaths: true` instead of the donor's `tsconfigPaths()` plugin; removed donor env/proxy specifics | Apache-2.0 |
| `packages/workshop-backend/vitest.integration.config.ts` | `vitest.config.ts`   | Adapted: `cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })` Vite-plugin pattern for the Workers pool; restructured into a two-project Vitest 4 config (`workers` + `unit` jsdom); removed capnweb/esbuild/onUnhandled specifics                                                            | Apache-2.0 |

Verification: `pnpm notices:check` fails unless the root `LICENSE` contains the
Apache License 2.0 text and the notice file is present, well-formed, cites the
pinned commit, and has no unresolved provenance rows.
