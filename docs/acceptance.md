# Release acceptance checklist

Open Events ships as one pnpm package and one deployable strict-TypeScript
modular monolith. Verify every item below from a clean checkout of the exact
candidate commit:

| #   | Check                                                                                                        | Command                                                             |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | Toolchain pinned: Node 22.14.0 + pnpm 11.17.0 (Corepack), lockfile frozen                                    | `pnpm install --frozen-lockfile`                                    |
| 2   | Formatting check passes                                                                                      | `pnpm format:check`                                                 |
| 3   | ESLint passes with zero warnings                                                                             | `pnpm lint`                                                         |
| 4   | Strict typecheck passes, including generated types                                                           | `pnpm typecheck`                                                    |
| 5   | Unit + Workers-pool integration tests pass                                                                   | `pnpm test`                                                         |
| 6   | Production build passes                                                                                      | `pnpm build`                                                        |
| 7   | Production preview serves the built app                                                                      | `pnpm preview`                                                      |
| 8   | `/api/health` reports safe build/database status only                                                        | `curl -fsS localhost:8787/api/health`                               |
| 9   | Local D1 migration/seed/reset and local R2 binding work without cloud credentials                            | `pnpm db:reset`                                                     |
| 10  | Application routes exercise the real D1-backed service and repository boundaries                             | `pnpm test`                                                         |
| 11  | Generated bindings/types exist and environment validation is wired                                           | `pnpm types:generate`                                               |
| 12  | shadcn/ui pinned to Base UI; no foreign UI kits                                                              | `pnpm ui:check`                                                     |
| 13  | Apache-2.0 LICENSE distributed; third-party provenance recorded and resolved                                 | `pnpm notices:check`                                                |
| 14  | Docs are public-safe; ignore rules cover secrets and local artifacts                                         | `git status --ignored`                                              |
| 15  | End-to-end smoke test passes with no local secrets configured (app loads, health visible, no console errors) | `pnpm e2e`                                                          |
| 16  | Full speaker, evaluator, organizer, onboarding, communications, agenda, and schedule journeys pass locally   | `LOCAL_ADMIN_TOKEN=local-test pnpm e2e:golden`                      |
| 17  | UI implementation passes the pinned Shadscan ruleset with a genuine 100 score                                | `npx --yes @shadscan/cli@0.12.0 --json --no-interactive --no-roast` |
| 18  | React implementation passes React Doctor with a genuine 100 score                                            | `npx --yes react-doctor@latest .`                                   |
| 19  | Full golden lifecycle passes against the deployed production Worker, D1, and R2                              | `LOCAL_ADMIN_TOKEN=... pnpm e2e:live`                               |

All items must pass on a clean tree before a release is considered complete.

The default end-to-end gate covers only the
specs that need no local secrets, and it resets and seeds the local database
before starting its own dev server, so the database reset is not a prerequisite.
The golden gate covers authenticated lifecycle journeys; it also resets the local
database, writes the supplied token into a local `.dev.vars` for the dev server,
and restores the previous `.dev.vars` when the run ends. Any local-only value
works as the token.

The live gate intentionally mutates the configured production event. It reads
passwordless links from the production D1 outbox without exposing a development
inbox route, and verifies Secure cookies plus remote D1/R2 persistence. Run it
only against a production dataset reserved for acceptance testing.
