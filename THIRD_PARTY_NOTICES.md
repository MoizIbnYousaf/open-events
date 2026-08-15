# Third-Party Notices

This project selectively reuses implementation code from
[`cloudflare/cloudflare-os`](https://github.com/cloudflare/cloudflare-os) at
pinned commit `1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592`, licensed under the
Apache License 2.0. Kumo UI, gadget/RPC/gatekeeper/Durable Object product
architecture, and the monorepo shape are **not** reused.

The exact Apache License 2.0 text is distributed at [`./LICENSE`](./LICENSE)
(copied verbatim from the pinned donor commit).

Every donor-derived file must have an entry here **before** it is committed:

| Source path in donor (pinned commit)                                    | Destination path                              | Modifications                                                                                                                                                                                                                                                                                                                                                                          | License    |
| ----------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `packages/workshop-frontend/src/router.tsx`                             | `src/app/router.tsx`                          | Adapted verbatim: same `createRouter` bootstrap (`scrollRestoration`, `defaultPreload`, `defaultPreloadStaleTime`) and `Register` module declaration                                                                                                                                                                                                                                   | Apache-2.0 |
| `packages/workshop-frontend/vite.config.ts`                             | `vite.config.ts`                              | Adapted: `TanStackRouterVite({ target: 'react', autoCodeSplitting: true })` plugin pattern and plugin order; added `routesDirectory`, `tailwindcss()`, `cloudflare()`; uses Vite 8 native `resolve.tsconfigPaths: true` instead of the donor's `tsconfigPaths()` plugin; removed donor env/proxy specifics                                                                             | Apache-2.0 |
| `packages/workshop-backend/vitest.integration.config.ts`                | `vitest.config.ts`                            | Adapted: `cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })` Vite-plugin pattern for the Workers pool; restructured into a two-project Vitest 4 config (`workers` + `unit` jsdom); removed capnweb/esbuild/onUnhandled specifics                                                                                                                                        | Apache-2.0 |
| `packages/workshop-frontend/src/components/AppShell/CommandPalette.tsx` | `src/app/features/command/command-actions.ts` | Adapted: the `fuzzyMatch` subsequence scorer (consecutive-run bonus, word-boundary bonus, earliest-match tie-break, null when not a subsequence). Re-expressed for our model — retyped with readonly results, folded into an AND-over-terms filter with a half-weight group fallback, a result cap, and score ordering; the donor's palette component, cache and chrome are not reused | Apache-2.0 |

## Heroicons (MIT)

The icon artwork in this product is derived from
[Heroicons](https://github.com/tailwindlabs/heroicons) v2 (outline), by Tailwind
Labs, licensed under the MIT License. Path data is copied into a first-party
module rather than taken as a runtime dependency; no Heroicons code is bundled.

| Upstream source                     | Destination path                      | Modifications                                                                                                                                                                                                                                                                                             | License |
| ----------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Heroicons v2 `optimized/24/outline` | `src/components/ui/icons.tsx`         | Path data copied and re-wrapped in first-party typed components: typed `size` union, size-dependent stroke compensation, `aria-hidden`/`focusable` defaults, product-semantic export names. Covers the glyphs ABOVE that file's "First-party drawings" divider only — see the mixed-provenance note below | MIT     |
| Heroicons v2 `optimized/24/outline` | `src/components/ui/dialog.tsx`        | Single `x-mark` path inlined (entry-chunk purity rule forbids an icon-module import here)                                                                                                                                                                                                                 | MIT     |
| Heroicons v2 `optimized/24/outline` | `src/components/ui/select.tsx`        | `chevron-down` / `chevron-up` / `check` paths inlined for the same reason                                                                                                                                                                                                                                 | MIT     |
| Heroicons v2 `optimized/24/outline` | `src/components/ui/native-select.tsx` | `chevron-down` path inlined for the same reason (the glyph cannot be painted inside a `<select>`, so it is drawn in the wrapper)                                                                                                                                                                          | MIT     |
| Heroicons v2 `optimized/24/outline` | `src/components/ui/dropdown-menu.tsx` | `check` / `chevron-right` paths inlined for the same reason                                                                                                                                                                                                                                               | MIT     |
| Heroicons v2 `optimized/24/outline` | `src/index.css`                       | `check` path embedded as a data-URI token for the native checkbox tick                                                                                                                                                                                                                                    | MIT     |

### Mixed provenance: `src/components/ui/icons.tsx`

That module carries both kinds of artwork, separated by a labelled divider in
the file. Above it: Heroicons v2 outline path data, covered by the MIT row
above. Below it: `DocumentIcon`, `DocumentStackIcon`, `StarIcon` and
`ClipboardIcon`, drawn for this product, owed to nobody, conforming to the same
geometry contract (24 viewBox, 1.5 stroke at 20px and up, round caps and joins)
so the two halves read as one system.

The provenance gate works at file granularity: it accepts this module through
the Heroicons row above and cannot tell the two halves apart, which is exactly
why the split is stated here and at the divider itself. Adding a
Heroicons-derived glyph below the divider, or a hand-drawn one above it, is a
provenance error that no script will catch.

```
MIT License

Copyright (c) Tailwind Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Verification: `pnpm notices:check` fails unless the root `LICENSE` contains the
Apache License 2.0 text and the notice file is present, well-formed, cites the
pinned commit, and has no unresolved provenance rows.

The gate checks provenance in **both** directions. Rows must point at files that
exist, and files must carry rows: every file under `src/`, `scripts/`, `tests/`
and `e2e/` that carries the donor-adaptation marker, or that ships SVG path data
in any form, must appear as a destination above — or be named explicitly as
first-party artwork in `scripts/notices-check.mjs`. Inlining a glyph to satisfy
the entry-chunk purity rule therefore cannot skip attribution silently.
