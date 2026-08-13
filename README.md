# Open Events

Open Events is an open-source event-program platform: organizers configure an
event and call for papers, speakers submit proposals (optionally with
co-speakers), evaluators score and organizers accept submissions, speakers
complete onboarding, and the public browses the programme.

This repository is the Open Events monolith: one pnpm package, one deployable,
strict TypeScript.

**Live demo:** [open-events.speakerops.workers.dev](https://open-events.speakerops.workers.dev)
— the public call for papers and programme are open to anyone. Organizer,
speaker and reviewer surfaces need a sign-in; see [Deploying](#deploying) to run
your own.

## What it does

- **Call for papers** — an organizer builds the form (typed questions, choices
  drawn from the event's own vocabulary, conditional questions), publishes it,
  and sets the window that opens and closes submissions.
- **Proposals** — speakers submit with co-speakers, save drafts that survive
  signing in, and revise what they sent while the call is open.
- **Review** — committee rounds with their own scorecards (ratings, choices,
  free text), per-round reviewer pools, blind review, conflict-of-interest
  recusal, one-action distribution of the reading, and weighted results.
- **Decisions and onboarding** — accept or reject, with every surface honouring
  the verdict; accepted speakers get an onboarding checklist.
- **Programme** — an agenda board with room, track and speaker conflict
  detection, assisted scheduling, and a public schedule.
- **Organizer view of people** — a speaker roster and a log of every message
  the event has sent.

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

`pnpm db:reset` gives you the minimal seeded event: one call for papers, no
proposals and an empty programme. `pnpm db:reset:programme` layers a published
programme on top — six accepted sessions across two days, two rooms and three
tracks — which is what the public schedule needs in order to show anything.

The programme layer is deliberately opt-in. The base seed's shape is asserted
exactly by a large part of the suite, and the golden journeys assert absolute row
totals that a seeded proposal would silently inflate.

## Quality gates

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint (zero warnings)
pnpm typecheck      # tsc strict
pnpm test           # Vitest: unit + Workers-pool integration
pnpm build          # production build
pnpm perf:check     # per-route and entry-closure size budgets
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

## Deploying

Open Events runs on Cloudflare Workers with D1 and R2. From a Cloudflare
account with Wrangler authenticated:

```bash
npx wrangler d1 create <your-database>
npx wrangler r2 bucket create <your-bucket>
# put both names into wrangler.jsonc, then:
npx wrangler d1 migrations apply <your-database> --remote
npx wrangler d1 execute <your-database> --remote --file src/db/seed.sql
npx wrangler deploy
```

Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to the origin you deploy to — a
mismatch refuses every authenticated write as cross-origin. Then set the
organizer secret:

```bash
npx wrangler secret put LOCAL_ADMIN_TOKEN
```

### Email

Outbound email is capture-only unless a provider is configured: every message
is recorded in the event's message log, and nothing is delivered. That is the
default so a checkout running the test suite can never mail real people. To
deliver for real, set both:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM     # must be on a domain you have verified
```

With no provider configured, organizers can still read every message — including
speaker and reviewer sign-in links — from **Messages** in the admin.

## License

Apache-2.0 — see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
