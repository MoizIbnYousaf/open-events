# Open Events

Open Events is an open-source event-program platform: organizers configure an
event and call for papers, speakers submit proposals (optionally with
co-speakers), evaluators score and organizers accept submissions, speakers
complete onboarding, and the public browses the programme.

This repository is the Open Events monolith: one pnpm package, one deployable,
strict TypeScript.

## Stack

- React + Vite + TanStack Router (file routes, automatic code splitting)
- Tailwind CSS + shadcn/ui on Base UI
- Hono API on Cloudflare Workers (same-origin `/api` routes)
- Drizzle + Cloudflare D1, Cloudflare R2 for validated private files
- TanStack Query/Table/Virtual, React Hook Form + Zod, dnd-kit

## Keyboard

| Chord                          | Does                                   |
| ------------------------------ | -------------------------------------- |
| `Cmd+K` / `Ctrl+K`             | Open or close the command menu         |
| `Cmd+Shift+D` / `Ctrl+Shift+D` | Cycle the theme: System → Light → Dark |
| `Cmd+Shift+L` / `Ctrl+Shift+L` | Cycle the theme (compatibility alias)  |

Inside the command menu: type to filter, `↑`/`↓` and `Home`/`End` to move,
`Enter` to go, `Escape` to close. Focus returns to the button that opened it,
and the search box is empty every time it opens.

Neither fires while you are typing in a text box, a text area, a select or a
rich-text field, so native text editing always wins — including `Ctrl+K`, which
deletes to the end of the line in macOS text controls.

The primary theme chord is `D`; `L` remains an alias for existing muscle
memory. `Cmd/Ctrl+Shift+D` overlaps browser commands, which remain available
from browser menus. See `docs/decisions.md` DEC-015 for the tradeoff.

## Development

Prerequisites: Node 22.14.0 and pnpm 11.17.0 (pinned in `.nvmrc` and
`packageManager`; enable via Corepack).

```bash
pnpm install --frozen-lockfile
pnpm dev       # Vite dev server; Worker API under /api
pnpm preview   # production preview
```

## Quality gates

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint (zero warnings)
pnpm typecheck      # tsc strict
pnpm test           # Vitest: unit + Workers-pool integration
pnpm build          # production build
pnpm ui:check       # shadcn Base UI pin, no foreign UI kits
pnpm notices:check  # license + third-party provenance
pnpm e2e            # Playwright end-to-end smoke test (no local secrets needed)
pnpm e2e:golden     # Playwright organizer journeys (needs LOCAL_ADMIN_TOKEN)
```

`pnpm e2e` needs no local secrets and runs from a clean checkout: it resets and
seeds the local database, then starts its own dev server.

`pnpm e2e:golden` signs in as an organizer, so it needs a local admin token in
the environment. Pick any local-only value:

```bash
LOCAL_ADMIN_TOKEN=local-test pnpm e2e:golden
```

It resets the local database, writes that token into a local `.dev.vars` for
the dev server, and restores whatever `.dev.vars` was there when the run ends.

Run every gate before submitting a contribution — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 — see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
