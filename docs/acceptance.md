# M1 acceptance checklist

M1 delivers a reproducible scaffold and architecture fitness proofs for one
pnpm package / one deployable strict-TypeScript modular monolith. Verify the
following from a clean checkout:

| #   | Check                                                                                                                   | Command                               |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Toolchain pinned: Node 22.14.0 + pnpm 11.17.0 (Corepack), lockfile frozen                                               | `pnpm install --frozen-lockfile`      |
| 2   | Formatting check passes                                                                                                 | `pnpm format:check`                   |
| 3   | ESLint passes with zero warnings                                                                                        | `pnpm lint`                           |
| 4   | Strict typecheck passes, including generated types                                                                      | `pnpm typecheck`                      |
| 5   | Unit + Workers-pool integration tests pass                                                                              | `pnpm test`                           |
| 6   | Production build passes                                                                                                 | `pnpm build`                          |
| 7   | Production preview serves the built app                                                                                 | `pnpm preview`                        |
| 8   | `/api/health` reports safe build/database status only                                                                   | `curl -fsS localhost:8787/api/health` |
| 9   | Local D1 migration/seed/reset and local R2 binding work without cloud credentials                                       | `pnpm db:reset`                       |
| 10  | Vertical placeholder slice (route -> application service -> repository) proves dependency direction with a real D1 read | —                                     |
| 11  | Generated bindings/types exist and environment validation is wired                                                      | `pnpm types:generate`                 |
| 12  | shadcn/ui pinned to Base UI; no foreign UI kits                                                                         | `pnpm ui:check`                       |
| 13  | Apache-2.0 LICENSE distributed; third-party provenance recorded and resolved                                            | `pnpm notices:check`                  |
| 14  | Docs are public-safe; ignore rules cover secrets and local artifacts                                                    | `git status --ignored`                |
| 15  | End-to-end smoke test passes (app loads, health visible, no console errors)                                             | `pnpm e2e`                            |

Items 1–15 must all pass on a clean tree before M1 is considered complete.
