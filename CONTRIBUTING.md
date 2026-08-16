# Contributing to Open Events

Thanks for contributing. Open Events is an open-source event-program platform
built as one pnpm package / one deployable strict-TypeScript modular
monolith. This guide covers setup, the quality gates, and contribution
conventions.

## Prerequisites

- Node.js 22.14.0 (see `.nvmrc`; `engines` requires `>=22.14.0`)
- pnpm 11.17.0, pinned via `packageManager` and enabled with Corepack:

```bash
corepack enable
pnpm --version   # expect 11.17.0
```

## Setup and development

```bash
pnpm install --frozen-lockfile   # install exactly what the lockfile pins
pnpm dev                         # Vite dev server; Worker API under /api
pnpm preview                     # production preview of the built app
```

Local database work is credential-free:

```bash
pnpm db:reset   # wipe local D1 state, apply migrations, seed DemoConf 2026
```

After changing `wrangler.jsonc`, regenerate the Worker bindings types:

```bash
pnpm types:generate
```

## Quality gates

Every gate below must pass before work is submitted. Run them on the branch
containing your changes:

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint (zero warnings)
pnpm typecheck      # tsc strict, including generated types
pnpm test           # Vitest: unit + Workers-pool integration
pnpm build          # production build (tsc -b && vite build)
pnpm ui:check       # shadcn/ui pinned to Base UI; no foreign UI kits
pnpm notices:check  # Apache-2.0 LICENSE + third-party provenance
pnpm e2e            # Playwright end-to-end smoke test (no local secrets needed)
pnpm e2e:golden     # Playwright organizer journeys (needs LOCAL_ADMIN_TOKEN)
```

`pnpm e2e` covers the specs that need no local secrets, and it runs from a
clean checkout: it resets and seeds the local database the way `pnpm db:reset`
does, then starts its own dev server on port 4173. When a dev server is already
listening there it reuses that one and leaves the local database untouched.
`pnpm e2e:golden` covers the specs that sign in as an organizer and needs a
local admin token:

```bash
LOCAL_ADMIN_TOKEN=local-test pnpm e2e:golden
```

That command resets the local database, writes the token into a local
`.dev.vars` for the dev server, and restores the previous `.dev.vars` when it
finishes. A spec that needs the token belongs in `playwright.golden.config.ts`,
not in the default gate.

Format changed files only:

```bash
pnpm exec prettier --write <changed paths>
```

## Contribution conventions

- **Small, atomic commits.** One logical change per commit with a clear,
  descriptive message. Never rewrite shared history or force-push.
- **Markdown only for docs.** Documentation changes are plain Markdown; no
  product code in documentation.
- **Keep secrets and local state out of commits.** `.gitignore` covers
  `.dev.vars*`, `.wrangler/`, environment files, logs, reports, screenshots,
  agent notes, briefs, credentials, `dist/`, and `.cache/`. Never commit real
  credentials or local-only state.
- **Coordinate cross-area changes.** Explain cross-cutting changes in the pull
  request and keep migrations, application behavior, and tests in one coherent
  review unit.

Before opening a pull request, run the quality gates listed above on a clean
working tree.
