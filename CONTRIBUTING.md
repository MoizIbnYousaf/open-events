# Contributing to SpeakerOps

Thanks for contributing. SpeakerOps is an open-source event-program platform
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
pnpm e2e            # Playwright end-to-end smoke test
```

Format changed files only:

```bash
pnpm exec prettier --write <changed paths>
```

## Contribution conventions

- **One writer per file.** Every file has a single designated owner; consult
  the repository's ownership manifest before editing and coordinate with the
  owner when your change touches an area you do not own. Reviews are
  read-only and findings are reported rather than applied directly.
- **Small, atomic commits.** One logical change per commit with a clear,
  descriptive message. Never rewrite shared history or force-push.
- **Markdown only for docs.** Documentation changes are plain Markdown; no
  product code in documentation.
- **Keep secrets and local state out of commits.** `.gitignore` covers
  `.dev.vars*`, `.wrangler/`, environment files, logs, reports, screenshots,
  agent notes, briefs, credentials, `dist/`, and `.cache/`. Never commit real
  credentials or local-only state.
- **Coordinate cross-area changes.** If a change affects more than one owned
  area, discuss it with the maintainers first rather than editing outside
  your scope.

## M1 acceptance checklist

The M1 milestone's clean-tree acceptance checklist lives in
[docs/acceptance.md](docs/acceptance.md); point reviewers there and confirm
every item passes before claiming M1 completion.
