# SpeakerOps

SpeakerOps is an open-source event-program platform: organizers configure an
event and call for papers, speakers submit proposals (optionally with
co-speakers), evaluators score and organizers accept submissions, speakers
complete onboarding, and the public browses the programme.

This repository is the SpeakerOps monolith: one pnpm package, one deployable,
strict TypeScript.

## Stack

- React + Vite + TanStack Router (file routes, automatic code splitting)
- Tailwind CSS + shadcn/ui on Base UI
- Hono API on Cloudflare Workers (same-origin `/api` routes)
- Drizzle + Cloudflare D1, Cloudflare R2 for validated private files
- TanStack Query/Table/Virtual, React Hook Form + Zod, dnd-kit

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
pnpm e2e            # Playwright end-to-end smoke test
```

Run every gate before submitting a contribution — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 — see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
